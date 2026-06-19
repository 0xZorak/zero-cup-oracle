/**
 * Preview the social posts (and verify X creds if set).
 *   npm run probe:x
 * With no X_* credentials this prints exactly what the agent would tweet at each
 * stage. With credentials set, the last block actually posts a test tweet.
 */
import { xConfigured, postTweet, prematchText, postmatchText } from "../social/x.js";
import type { Fixture } from "../agent/predict.js";

const f: Fixture = {
  matchId: "wc2026-m57",
  home: "Morocco",
  away: "Senegal",
  competition: "FIFA World Cup 2026",
  kickoffUtc: "2026-07-04T19:00:00Z",
};

async function main() {
  console.log(`X configured: ${xConfigured()} (${xConfigured() ? "will POST" : "dry-run, prints only"})\n`);

  console.log("── pre-match ──");
  await postTweet(prematchText(f, { outcome: "HOME", scoreline: "2-1", confidence: 0.62, rationale: "x" }));

  console.log("\n── post-match (correct) ──");
  await postTweet(postmatchText(f.home, f.away, "HOME", "HOME", true, 7500));

  console.log("\n── post-match (miss) ──");
  await postTweet(postmatchText(f.home, f.away, "HOME", "AWAY", false, 6600));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
