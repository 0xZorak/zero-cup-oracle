/**
 * The Oracle — MCP server.
 *
 * Exposes the on-chain World Cup Oracle to ANY MCP client (Claude Desktop, Cursor,
 * other agents) as a set of tools. The whole point of the product — a track record
 * nobody can fake — becomes something another agent can read AND independently
 * verify, with no trust in our server:
 *
 *   • oracle_get_scoreboard   — total / resolved / correct / accuracy, straight from chain
 *   • oracle_list_predictions — every committed call (on-chain fields)
 *   • oracle_get_prediction   — one call + its full record fetched from 0G Storage
 *   • oracle_verify_prediction— re-fetch the record, recompute keccak, assert it
 *                               equals the on-chain hash + committed before kickoff
 *                               + every agent's TEE signature was valid
 *   • oracle_predict_match    — (write, needs PRIVATE_KEY) run the TEE panel and
 *                               commit a fresh prediction on-chain before kickoff
 *
 * The read tools need NO private key — only public 0G RPC + the Storage gateway,
 * exactly like the browser Verify button. Runs over stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Contract, JsonRpcProvider } from "ethers";
import { recordHash } from "../src/canonical.js";
import type { PredictionRecord } from "../src/types.js";

// ── config (env with sensible defaults → runs read-only out of the box) ──
const RPC_URL = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const CHAIN_ID = Number(process.env.OG_CHAIN_ID ?? "16602");
const ORACLE_CONTRACT =
  process.env.ORACLE_CONTRACT_ADDRESS ?? "0xBdA8083aCCf45Fe5b838936C94D53a91042D9Bbb";
const STORAGE_INDEXER =
  process.env.OG_STORAGE_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";
const INFT_CONTRACT =
  process.env.INFT_CONTRACT_ADDRESS ?? "0x92DCcfA420397bAF3e60A3a673c6c1cC9677e9cC";

// Only the read views the verifier needs — no key, no writes.
const READ_ABI = [
  "function getPrediction(uint256 id) view returns (tuple(uint256 matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint64 committedAt, uint8 predicted, uint8 actual, uint8 status))",
  "function totalPredictions() view returns (uint256)",
  "function correctCount() view returns (uint256)",
  "function resolvedCount() view returns (uint256)",
  "function accuracyBps() view returns (uint256)",
] as const;

const OUTCOME = ["HOME", "DRAW", "AWAY"] as const;
const STATUS = ["Pending", "Correct", "Wrong"] as const;

const INFT_ABI = [
  "function tokenOfPrediction(uint256 predictionId) view returns (uint256)",
] as const;

const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const oracle = new Contract(ORACLE_CONTRACT, READ_ABI, provider);
const inft = new Contract(INFT_CONTRACT, INFT_ABI, provider);

/** The soulbound iNFT token id minted for a prediction, or null if none. */
async function inftTokenFor(predictionId: number): Promise<number | null> {
  try {
    const t = Number(await inft.tokenOfPrediction(predictionId));
    return t > 0 ? t - 1 : null;
  } catch {
    return null;
  }
}

interface OnChain {
  id: number;
  matchId: string;
  recordHash: string;
  storageRoot: string;
  kickoff: number;
  committedAt: number;
  predicted: string;
  actual: string;
  status: string;
  inftTokenId: number | null;
}

async function readPrediction(id: number): Promise<OnChain> {
  const [p, inftTokenId] = await Promise.all([oracle.getPrediction(id), inftTokenFor(id)]);
  return {
    id,
    matchId: p.matchId.toString(),
    recordHash: p.recordHash,
    storageRoot: p.storageRoot,
    kickoff: Number(p.kickoff),
    committedAt: Number(p.committedAt),
    predicted: OUTCOME[Number(p.predicted)],
    actual: OUTCOME[Number(p.actual)],
    status: STATUS[Number(p.status)],
    inftTokenId,
  };
}

/** Fetch the full record JSON from the 0G Storage gateway by its root hash. */
async function fetchRecord(storageRoot: string): Promise<PredictionRecord> {
  const url = `${STORAGE_INDEXER}/file?root=${storageRoot}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`0G Storage gateway ${res.status} for root ${storageRoot}`);
  return (await res.json()) as PredictionRecord;
}

const json = (obj: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
});

// ── server ──
const server = new McpServer({ name: "the-oracle", version: "0.1.0" });

server.tool(
  "oracle_get_scoreboard",
  "The Oracle's public accuracy, computed entirely from 0G Chain (never a database): total predictions, how many are resolved, how many were correct, and the accuracy percentage.",
  {},
  async () => {
    const [total, resolved, correct, bps] = await Promise.all([
      oracle.totalPredictions(),
      oracle.resolvedCount(),
      oracle.correctCount(),
      oracle.accuracyBps(),
    ]);
    return json({
      contract: ORACLE_CONTRACT,
      chainId: CHAIN_ID,
      totalPredictions: Number(total),
      resolved: Number(resolved),
      correct: Number(correct),
      accuracyPercent: Number(bps) / 100,
      note: "Every figure is derived from on-chain state and is independently verifiable.",
    });
  },
);

server.tool(
  "oracle_list_predictions",
  "List every prediction the Oracle has committed on-chain, newest first. Returns the on-chain fields (id, teams' matchId, predicted outcome, status, kickoff, the keccak record hash and the 0G Storage root). Use oracle_get_prediction for the full reasoning, or oracle_verify_prediction to prove integrity.",
  { limit: z.number().int().positive().max(100).optional().describe("Max rows (default 25)") },
  async ({ limit }) => {
    const total = Number(await oracle.totalPredictions());
    const cap = limit ?? 25;
    const ids: number[] = [];
    for (let i = total - 1; i >= 0 && ids.length < cap; i--) ids.push(i);
    const rows = await Promise.all(ids.map(readPrediction));
    return json({ total, returned: rows.length, predictions: rows });
  },
);

server.tool(
  "oracle_get_prediction",
  "Get one prediction by id, including its FULL record fetched from 0G Storage: the matched teams, the judge's call + scoreline + confidence + rationale, and the multi-agent TEE panel debate.",
  { id: z.number().int().nonnegative().describe("On-chain prediction id (0-based)") },
  async ({ id }) => {
    const total = Number(await oracle.totalPredictions());
    if (id >= total)
      return json({ id, error: `No prediction #${id} — only ${total} exist (ids 0..${total - 1}).` });
    const onChain = await readPrediction(id);
    let record: PredictionRecord | { error: string };
    try {
      record = await fetchRecord(onChain.storageRoot);
    } catch (e) {
      record = { error: (e as Error).message };
    }
    return json({ onChain, record });
  },
);

server.tool(
  "oracle_verify_prediction",
  "Independently verify a prediction with zero trust in our server — the same check the browser runs. Re-fetches the record from 0G Storage, recomputes keccak256(canonicalJSON(record)), and asserts it equals the on-chain hash; also asserts the commit landed BEFORE kickoff and that every agent's inference carried a valid TEE signature. Returns a structured pass/fail proof.",
  { id: z.number().int().nonnegative().describe("On-chain prediction id to verify") },
  async ({ id }) => {
    const total = Number(await oracle.totalPredictions());
    if (id >= total)
      return json({ id, verified: false, error: `No prediction #${id} — only ${total} exist (ids 0..${total - 1}).` });
    const onChain = await readPrediction(id);
    let record: PredictionRecord;
    try {
      record = await fetchRecord(onChain.storageRoot);
    } catch (e) {
      return json({ id, verified: false, error: `could not fetch record: ${(e as Error).message}` });
    }

    const recomputed = recordHash(record);
    const hashMatches = recomputed.toLowerCase() === onChain.recordHash.toLowerCase();
    const committedBeforeKickoff = onChain.committedAt > 0 && onChain.committedAt < onChain.kickoff;
    const panel = record.debate?.panel ?? [];
    const teeValid =
      record.provenance.teeSignatureValid && panel.every((a) => a.teeSignatureValid);

    const verified = hashMatches && committedBeforeKickoff && teeValid;
    return json({
      id,
      verified,
      match: `${record.match.home} vs ${record.match.away}`,
      checks: {
        integrity_hashMatchesChain: {
          pass: hashMatches,
          onChainHash: onChain.recordHash,
          recomputedHash: recomputed,
        },
        preKickoff_committedBeforeKickoff: {
          pass: committedBeforeKickoff,
          committedAt: new Date(onChain.committedAt * 1000).toISOString(),
          kickoff: new Date(onChain.kickoff * 1000).toISOString(),
        },
        authenticity_teeSignaturesValid: {
          pass: teeValid,
          judge: record.provenance.teeSignatureValid,
          panelAgents: panel.map((a) => ({ agent: a.agent, valid: a.teeSignatureValid })),
        },
      },
      call: { outcome: onChain.predicted, status: onChain.status, scoreline: record.prediction.scoreline },
      storageRoot: onChain.storageRoot,
    });
  },
);

server.tool(
  "oracle_predict_match",
  "(Write — requires PRIVATE_KEY + funded 0G wallet) Have the Oracle predict a match RIGHT NOW: runs the multi-agent TEE panel, writes the record to 0G Storage, and commits its hash on-chain before kickoff. Returns the new on-chain id and tx hash. Without a key the read tools still work; this one will report that it's unconfigured.",
  {
    matchId: z.string().describe("Stable match id, e.g. 'wc2026-m61'"),
    home: z.string(),
    away: z.string(),
    kickoffUtc: z.string().describe("ISO 8601 kickoff time, must be in the future"),
    competition: z.string().optional().describe("Default 'FIFA World Cup 2026'"),
  },
  async (args) => {
    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.startsWith("0x...")) {
      return json({
        ok: false,
        error: "PRIVATE_KEY not set — this MCP server is running read-only. Set it (and a funded 0G wallet) to enable on-chain commits.",
      });
    }
    const computeProvider = process.env.COMPUTE_PROVIDER_ADDRESS;
    if (!computeProvider || computeProvider.startsWith("0x...")) {
      return json({ ok: false, error: "COMPUTE_PROVIDER_ADDRESS not set — needed to run TEE inference." });
    }
    // Lazy import so the read-only server never pulls in the key-requiring pipeline.
    const { makeBroker, ensureLedger } = await import("../src/broker/compute.js");
    const { predictMatch } = await import("../src/agent/predictMatch.js");
    const { wallet, broker } = await makeBroker();
    await ensureLedger(broker);
    const result = await predictMatch(wallet, broker, computeProvider, {
      matchId: args.matchId,
      home: args.home,
      away: args.away,
      competition: args.competition ?? "FIFA World Cup 2026",
      kickoffUtc: args.kickoffUtc,
    });
    return json({ ok: true, result });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe to log to (stdout is the MCP transport).
console.error(
  `[the-oracle] MCP server up — contract ${ORACLE_CONTRACT} on chain ${CHAIN_ID}` +
    (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith("0x...")
      ? " (write-enabled)"
      : " (read-only)"),
);
