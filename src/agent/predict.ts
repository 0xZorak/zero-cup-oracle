import type { Outcome } from "../types.js";

export interface Fixture {
  matchId: string; // "wc2026-m57"
  home: string;
  away: string;
  competition: string;
  kickoffUtc: string; // ISO
  context?: string; // form, H2H, injuries — whatever the data feed gives us
}

export interface ParsedPrediction {
  outcome: Outcome;
  scoreline: string;
  confidence: number;
  rationale: string;
}

/**
 * Deterministic uint matchId for the contract, derived from the string id.
 * Both the predict and resolve paths must derive it identically.
 */
export function matchIdToNum(matchId: string): bigint {
  return BigInt("0x" + Buffer.from(matchId).toString("hex").slice(-12));
}

/**
 * THE PERSONA. This is not decoration — in the community-vote rounds (Jul 8+),
 * people vote for a character they've been watching, not a hash. "The Oracle"
 * stakes its reputation in public, with swagger, but the verifiability underneath
 * keeps the swagger honest. Keep the voice; keep the strict output contract.
 */
export function buildPrompt(f: Fixture): string {
  return [
    "You are THE ORACLE — an autonomous football oracle that runs inside a secure",
    "enclave and commits every call on-chain BEFORE kickoff. You are confident,",
    "sharp, and a little cocky, because your record is public and un-fakeable.",
    "",
    `MATCH: ${f.home} vs ${f.away} — ${f.competition}`,
    `KICKOFF (UTC): ${f.kickoffUtc}`,
    f.context ? `CONTEXT: ${f.context}` : "",
    "",
    "Give your call. Then output EXACTLY one machine-readable line, last, no prose after it:",
    "VERDICT outcome=<HOME|DRAW|AWAY> score=<H-A> confidence=<0.00-1.00> reason=<=120 chars",
    "",
    "Example final line:",
    "VERDICT outcome=HOME score=2-1 confidence=0.62 reason=Home press too much for a tired back line",
  ]
    .filter(Boolean)
    .join("\n");
}

const VERDICT_RE =
  /VERDICT\s+outcome=(HOME|DRAW|AWAY)\s+score=(\d+-\d+)\s+confidence=([01](?:\.\d+)?)\s+reason=(.+)/i;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Parse the model's call. Tries the strict VERDICT line first, then falls back
 * to lenient extraction — LLMs (especially the contrarian persona) don't always
 * honour the exact format, and a 4-agent panel makes that failure 4× as likely.
 */
export function parsePrediction(modelOutput: string): ParsedPrediction {
  const strict = modelOutput.match(VERDICT_RE);
  if (strict) {
    return {
      outcome: strict[1].toUpperCase() as Outcome,
      scoreline: strict[2],
      confidence: clamp01(Number(strict[3])),
      rationale: strict[4].trim().slice(0, 120),
    };
  }

  // Lenient fallback: find an outcome and a scoreline anywhere in the text.
  const outcomes = [...modelOutput.matchAll(/\b(HOME|DRAW|AWAY)\b/gi)];
  const score = modelOutput.match(/\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/);
  if (outcomes.length && score) {
    const outcome = outcomes[outcomes.length - 1][1].toUpperCase() as Outcome;
    const pct = modelOutput.match(/confidence[=:\s]+([01](?:\.\d+)?)/i);
    const pctSign = modelOutput.match(/(\d{1,3})\s*%/);
    const confidence = pct ? clamp01(Number(pct[1])) : pctSign ? clamp01(Number(pctSign[1]) / 100) : 0.6;
    const reason = modelOutput.match(/reason=(.+)/i);
    const rationale = (reason ? reason[1] : modelOutput.trim().split("\n")[0]).trim().slice(0, 120);
    return { outcome, scoreline: `${score[1]}-${score[2]}`, confidence, rationale };
  }

  throw new Error(`Could not parse a prediction from model output:\n${modelOutput}`);
}
