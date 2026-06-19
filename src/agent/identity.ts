import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Wallet } from "ethers";
import { uploadRecord } from "../broker/storage.js";

const ID_PATH = "data/agent-id.json";

export interface AgentIdentity {
  did: string; // did:0g:<address>
  address: string; // the agent wallet — the sole on-chain writer
  agentCardRoot: string; // 0G Storage root of the identity card
}

/**
 * 0G Agentic ID, the provable core of it: the agent's identity is its wallet
 * (already the only address the registry accepts writes from). We publish a
 * signed "agent card" to 0G Storage and bind its DID + root into every
 * prediction record — and since each record's hash is committed on-chain before
 * kickoff, the agent identity is transitively committed too. Minting the full
 * ERC-7857 iNFT is the upgrade path; this gives the verifiable identity now.
 */
export async function ensureAgentIdentity(
  wallet: Wallet,
  panel: { agent: string; role: string }[],
): Promise<AgentIdentity> {
  if (existsSync(ID_PATH)) {
    return JSON.parse(readFileSync(ID_PATH, "utf8")) as AgentIdentity;
  }
  const address = await wallet.getAddress();
  const did = `did:0g:${address}`;
  const card = {
    schema: "0g-agentic-id/1.0",
    standard: "ERC-7857 (iNFT) — identity card on 0G Storage; on-chain mint is future work",
    did,
    address,
    name: "The Oracle",
    description:
      "Autonomous, verifiable World Cup prediction agent. A multi-agent panel reasons inside 0G TEEs; the judge commits one call on-chain before every kickoff.",
    panel: panel.map((p) => ({ agent: p.agent, role: p.role })),
    createdAtUtc: new Date().toISOString(),
  };
  const up = await uploadRecord(wallet, card);
  const identity: AgentIdentity = { did, address, agentCardRoot: up.rootHash };
  mkdirSync("data", { recursive: true });
  writeFileSync(ID_PATH, JSON.stringify(identity, null, 2));
  console.log(`  [identity] agent card published: ${did} root=${up.rootHash.slice(0, 12)}…`);
  return identity;
}
