import { Wallet } from "ethers";
import { config } from "../config.js";
import {
  resolvePrediction,
  getPrediction,
  accuracyBps,
  totalPredictions,
} from "../broker/contract.js";
import { matchIdToNum } from "./predict.js";
import { getFinishedResults } from "../data/football.js";
import { postTweet, postmatchText } from "../social/x.js";
import type { Outcome } from "../types.js";

/** Team names live in the 0G Storage record; fetch them for the receipt tweet. */
async function teamsFor(storageRoot: string): Promise<{ home: string; away: string }> {
  try {
    const r = await fetch(`${config.storageIndexerUrl}/file?root=${storageRoot}`);
    const rec = (await r.json()) as { match?: { home?: string; away?: string } };
    return { home: rec?.match?.home ?? "Home", away: rec?.match?.away ?? "Away" };
  } catch {
    return { home: "Home", away: "Away" };
  }
}

/**
 * Post-match resolution — CHAIN-DRIVEN (no local cursor needed, so it works on
 * ephemeral runners like GitHub Actions and survives cursor loss). For every
 * finished result, find the matching on-chain prediction that's still Pending and
 * write the result, which flips it Correct/Wrong and updates public accuracy.
 * Idempotent: the contract's own status guard + the Pending check prevent
 * double-resolution.
 */
export async function resolveTick(wallet: Wallet): Promise<void> {
  const results = await getFinishedResults();
  if (results.size === 0) {
    console.log(`[resolve ${new Date().toISOString()}] no finished results available`);
    return;
  }

  // Index results by the on-chain numeric matchId (keccak-derived, one-way), so
  // we can match them against what's stored on-chain.
  const byNum = new Map<string, Outcome>();
  for (const [strId, actual] of results) byNum.set(matchIdToNum(strId).toString(), actual);

  const total = await totalPredictions(wallet);
  let resolved = 0;
  for (let id = 0; id < total; id++) {
    let onChain;
    try {
      onChain = await getPrediction(wallet, id);
    } catch {
      continue;
    }
    if (onChain.status !== "Pending") continue;
    const actual = byNum.get(onChain.matchId.toString());
    if (!actual) continue;

    try {
      const txHash = await resolvePrediction(wallet, BigInt(id), actual);
      const correct = onChain.predicted === actual;
      console.log(
        `  ${correct ? "✅ called it" : "❌ missed it"}: id=${id} predicted=${onChain.predicted} ` +
          `actual=${actual} tx=${txHash.slice(0, 12)}…`,
      );
      resolved++;

      // Post the un-fakeable receipt (non-fatal; dry-runs without X creds).
      try {
        const bps = await accuracyBps(wallet);
        const { home, away } = await teamsFor(onChain.storageRoot);
        await postTweet(postmatchText(home, away, onChain.predicted, actual, correct, bps));
      } catch (err) {
        console.warn(`  ⚠ x post-match post failed: ${(err as Error).message}`);
      }
    } catch (e) {
      console.error(`  ✗ resolve id=${id}:`, (e as Error).message);
    }
  }
  console.log(`[resolve ${new Date().toISOString()}] resolved ${resolved} match(es)`);
}
