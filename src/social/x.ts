import crypto from "node:crypto";
import { config } from "../config.js";
import type { Outcome } from "../types.js";
import type { Fixture, ParsedPrediction } from "../agent/predict.js";

const TWEET_URL = "https://api.twitter.com/2/tweets";

/** True only when all four OAuth 1.0a credentials are present. */
export function xConfigured(): boolean {
  return Boolean(config.xApiKey && config.xApiSecret && config.xAccessToken && config.xAccessSecret);
}

// RFC 3986 percent-encoding (encodeURIComponent leaves !*'() unescaped).
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Build the OAuth 1.0a Authorization header for a POST to the X v2 API. v2
 * endpoints take a JSON body, which is NOT part of the signature base string —
 * only the oauth_* params are signed.
 */
function authHeader(method: string, url: string): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: config.xApiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.xAccessToken,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}=${enc(oauth[k])}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join("&");
  const signingKey = `${enc(config.xApiSecret)}&${enc(config.xAccessSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");

  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(", ")
  );
}

/** Post a tweet. With no credentials this is a dry-run that prints the text. */
export async function postTweet(text: string): Promise<{ id?: string; dryRun?: boolean }> {
  if (!xConfigured()) {
    console.log("  [x:dry-run] would post:\n" + text.split("\n").map((l) => "    | " + l).join("\n"));
    return { dryRun: true };
  }
  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: authHeader("POST", TWEET_URL), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`X API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: { id?: string } };
  console.log(`  [x] posted tweet ${body.data?.id ?? "?"}`);
  return { id: body.data?.id };
}

// ── persona copy ───────────────────────────────────────────────────────────────

/** Pre-kickoff: the Oracle stakes its reputation, in public, before the ball. */
export function prematchText(f: Fixture, p: ParsedPrediction): string {
  const call = p.outcome === "DRAW" ? "DRAW" : `${p.outcome} WIN`;
  return [
    `🔮 THE ORACLE HAS SPOKEN`,
    ``,
    `${f.home} vs ${f.away}`,
    `Call: ${call} · ${p.scoreline} · ${Math.round(p.confidence * 100)}% confidence`,
    ``,
    `Reasoned in a TEE, committed on-chain BEFORE kickoff. It cannot be faked.`,
    `Verify it yourself 👇`,
    config.frontendUrl,
  ].join("\n");
}

/** Post-match: the un-fakeable receipt — called it, or owned the miss. */
export function postmatchText(
  home: string,
  away: string,
  predicted: Outcome,
  actual: Outcome,
  correct: boolean,
  accuracyBps: number,
): string {
  const acc = (accuracyBps / 100).toFixed(0);
  if (correct) {
    return [
      `✅ CALLED IT.`,
      ``,
      `${home} vs ${away} → ${actual}`,
      `The Oracle said ${predicted}, before kickoff, on-chain.`,
      ``,
      `Track record: ${acc}% accurate and provable.`,
      `Check it 👇`,
      config.frontendUrl,
    ].join("\n");
  }
  return [
    `❌ MISSED THIS ONE.`,
    ``,
    `${home} vs ${away} → ${actual}`,
    `The Oracle said ${predicted}. No hiding it — every call is on-chain.`,
    ``,
    `Still ${acc}% overall. That's the honest scoreboard 👇`,
    config.frontendUrl,
  ].join("\n");
}
