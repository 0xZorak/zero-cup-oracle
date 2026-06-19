import { Wallet } from "ethers";
import { cursor } from "./cursor.js";
import { resolvePrediction, getPrediction, accuracyBps } from "../broker/contract.js";
import { getFinishedResults } from "../data/football.js";
import { postTweet, postmatchText } from "../social/x.js";

/**
 * Post-match resolution. For every match we predicted but haven't resolved, look
 * up the finished result and write it on-chain — which flips the prediction to
 * Correct/Wrong and updates the public accuracy. Idempotent via the cursor and
 * the contract's own status guard.
 */
export async function resolveTick(wallet: Wallet): Promise<void> {
  const results = await getFinishedResults();
  if (results.size === 0) {
    console.log(`[resolve ${new Date().toISOString()}] no finished results available`);
    return;
  }

  let resolved = 0;
  for (const [matchId, actual] of results) {
    if (!cursor.isPredicted(matchId) || cursor.isResolved(matchId)) continue;
    const id = cursor.predictionId(matchId);
    if (id === undefined) continue;

    try {
      // Skip if already resolved on-chain (e.g. cursor lost but chain knows).
      const onChain = await getPrediction(wallet, id);
      if (onChain.status !== "Pending") {
        cursor.markResolved(matchId, { txHash: "", actual: onChain.actual });
        continue;
      }

      const txHash = await resolvePrediction(wallet, BigInt(id), actual);
      cursor.markResolved(matchId, { txHash, actual });
      const correct = onChain.predicted === actual;
      const hit = correct ? "✅ called it" : "❌ missed it";
      console.log(`  ${hit}: ${matchId} predicted=${onChain.predicted} actual=${actual} tx=${txHash.slice(0, 12)}…`);
      resolved++;

      // Post the un-fakeable receipt (non-fatal).
      try {
        const e = cursor.getPredicted(matchId);
        const bps = await accuracyBps(wallet);
        await postTweet(
          postmatchText(e?.home ?? "Home", e?.away ?? "Away", onChain.predicted, actual, correct, bps),
        );
      } catch (err) {
        console.warn(`  ⚠ x post-match post failed: ${(err as Error).message}`);
      }
    } catch (e) {
      console.error(`  ✗ resolve ${matchId}:`, (e as Error).message);
    }
  }
  console.log(`[resolve ${new Date().toISOString()}] resolved ${resolved} match(es)`);
}
