import { mkdirSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { uploadRecord } from "../broker/storage.js";
import { commitPrediction, alreadyCommitted } from "../broker/contract.js";
import { mintPredictionINFT, inftConfigured } from "../broker/inft.js";
import { recordHash } from "../canonical.js";
import { cursor } from "./cursor.js";
import { matchIdToNum, type Fixture } from "./predict.js";
import { runPanel } from "./panel.js";
import { scoutFixture } from "./research.js";
import { ensureAgentIdentity } from "./identity.js";
import { postTweet, prematchText } from "../social/x.js";
import type { PredictionRecord } from "../types.js";

/**
 * The full pre-kickoff pipeline for ONE match, deterministic end-to-end:
 *   inference + TEE verify → assemble record → 0G Storage → on-chain commit.
 * The commit tx MUST mine before kickoff — the contract enforces it, and that
 * inequality is the whole integrity claim.
 */
export async function predictMatch(
  wallet: Wallet,
  broker: ZGComputeNetworkBroker,
  provider: string,
  f: Fixture,
): Promise<{ skipped?: string; recordHash?: string; txHash?: string }> {
  if (cursor.isPredicted(f.matchId)) return { skipped: "already predicted (cursor)" };

  const matchIdNum = matchIdToNum(f.matchId);
  if (await alreadyCommitted(wallet, matchIdNum)) {
    return { skipped: "already committed (chain)" };
  }

  const kickoffUnix = Math.floor(new Date(f.kickoffUtc).getTime() / 1000);
  if (Date.now() / 1000 >= kickoffUnix) return { skipped: "past kickoff — refuse to commit" };

  // 0. Scout: enrich the fixture with real form/standings (no-op without a key).
  const scouted = await scoutFixture(f);

  // 1. The panel debates inside the TEE, then the judge commits the call.
  console.log(`  [1/4] panel debate + TEE verify…`);
  const result = await runPanel(broker, provider, scouted);
  const parsed = result.final;
  const inf = result.judgeInference; // authoritative provenance
  console.log(
    `        verdict ${parsed.outcome} ${parsed.scoreline} (tee_all=${result.allTeeValid})`,
  );

  // Save the attestation/proof artifact so the record can reference it.
  mkdirSync("data/attestations", { recursive: true });
  const attestationRef = `data/attestations/${f.matchId}.json`;
  writeFileSync(
    attestationRef,
    JSON.stringify(
      { judgeChatId: inf.chatId, allTeeValid: result.allTeeValid, panel: result.panel },
      null,
      2,
    ),
  );

  // Ensure the agent has a published 0G identity card (uploaded once, cached).
  const identity = await ensureAgentIdentity(wallet, result.panel);

  // 2. Assemble the canonical record.
  const record: PredictionRecord = {
    schemaVersion: "1.0",
    agentId: identity.did,
    agentCardRoot: identity.agentCardRoot,
    match: {
      id: f.matchId,
      home: f.home,
      away: f.away,
      competition: f.competition,
      kickoffUtc: f.kickoffUtc,
    },
    prediction: parsed,
    debate: { panel: result.panel, consensus: result.consensus },
    provenance: {
      provider: inf.provider,
      model: inf.model,
      chatId: inf.chatId,
      verificationMode: "TeeML",
      teeSignatureValid: result.allTeeValid,
      attestationRef,
    },
    createdAtUtc: new Date().toISOString(),
    dataSources: scouted.context !== f.context ? ["football-data.org", "scout:standings"] : ["football-data.org"],
  };

  const hash = recordHash(record);
  console.log(`  [2/4] record hashed: ${hash.slice(0, 18)}…`);

  // 3. Upload the full record to 0G Storage.
  console.log(`  [3/4] uploading to 0G Storage…`);
  const up = await uploadRecord(wallet, record);
  console.log(`        rootHash: ${up.rootHash.slice(0, 18)}…`);

  // 4. Commit the hash on-chain — before kickoff. The contract carries both the
  //    keccak record hash and the 0G Storage root so the frontend can verify.
  console.log(`  [4/4] committing on-chain…`);
  const { txHash, id } = await commitPrediction(
    wallet,
    matchIdNum,
    hash,
    up.rootHash,
    kickoffUnix,
    parsed.outcome,
  );

  cursor.markPredicted(f.matchId, { id, recordHash: hash, txHash, home: f.home, away: f.away });

  console.log(
    `✅ ${f.home} v ${f.away}: ${parsed.outcome} (${parsed.scoreline}) ` +
      `tee=${inf.teeSignatureValid} id=${id} root=${up.rootHash.slice(0, 12)}… commit=${txHash.slice(0, 12)}…`,
  );

  // 4.5 Mint the soulbound iNFT binding this call to the Agentic ID + 0G record
  //      (non-fatal — the prediction is already committed; this is provenance).
  if (inftConfigured() && id >= 0) {
    try {
      const minted = await mintPredictionINFT(wallet, id, hash, up.rootHash);
      if (minted) console.log(`  🪙 iNFT #${minted.tokenId} minted (tx ${minted.txHash.slice(0, 12)}…)`);
    } catch (e) {
      console.warn(`  ⚠ iNFT mint failed (non-fatal): ${(e as Error).message}`);
    }
  }

  // 5. Stake the reputation in public — pre-kickoff post (non-fatal).
  try {
    await postTweet(prematchText(f, parsed));
  } catch (e) {
    console.warn(`  ⚠ x pre-match post failed: ${(e as Error).message}`);
  }

  return { recordHash: hash, txHash };
}
