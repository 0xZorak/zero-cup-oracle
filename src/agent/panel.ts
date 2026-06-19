import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { runVerifiedInference, type InferenceResult } from "../broker/compute.js";
import { parsePrediction, type Fixture, type ParsedPrediction } from "./predict.js";
import type { DebateEntry } from "../types.js";

/**
 * The Oracle is not one model — it's a panel. Three analyst agents each reason
 * about the match inside their own TEE inference, from a different lens, then a
 * judge agent weighs the disagreement and commits the final call. Every step is
 * TEE-verified; the debate is stored on 0G alongside the verdict. This is the
 * visibly-agentic core: "three agents argue, the consensus goes on-chain."
 */
interface PanelAgent {
  name: string;
  role: string;
  system: string;
}

const PANEL: PanelAgent[] = [
  {
    name: "The Statistician",
    role: "cold numbers — form, goals, xG, head-to-head",
    system:
      "You are THE STATISTICIAN. You care ONLY about data: recent form, goals for/against, " +
      "expected goals, and head-to-head history. No vibes, no narratives. Be terse and numeric.",
  },
  {
    name: "The Tactician",
    role: "matchups, shape, personnel",
    system:
      "You are THE TACTICIAN. You read the tactical matchup: press vs build-up, the full-back " +
      "battles, who controls midfield, and the impact of injuries or suspensions. Be concrete.",
  },
  {
    name: "The Contrarian",
    role: "hunts the upset",
    system:
      "You are THE CONTRARIAN. You fade the crowd and hunt the upset. If the favourite is " +
      "overrated, flat, or rotating, say so. Be bold but give a real reason.",
  },
];

const VERDICT_INSTRUCTION = [
  "Write in English. Give a 1-2 sentence take, then output EXACTLY one final line, nothing after it:",
  "VERDICT outcome=<HOME|DRAW|AWAY> score=<H-A> confidence=<0.00-1.00> reason=<=100 chars",
].join("\n");

function analystPrompt(f: Fixture, system: string): string {
  return [
    system,
    "",
    `MATCH: ${f.home} vs ${f.away} — ${f.competition}`,
    `KICKOFF (UTC): ${f.kickoffUtc}`,
    f.context ? `CONTEXT: ${f.context}` : "",
    "",
    VERDICT_INSTRUCTION,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The agent's prose minus the machine VERDICT line. */
function extractTake(content: string): string {
  const take = content.replace(/VERDICT\s+outcome=.*/is, "").trim();
  return (take || "(no commentary)").slice(0, 240);
}

function judgePrompt(f: Fixture, entries: DebateEntry[]): string {
  const board = entries
    .map(
      (e) =>
        `- ${e.agent}: ${e.outcome} ${e.scoreline} (conf ${e.confidence.toFixed(2)}) — "${e.take}"`,
    )
    .join("\n");
  return [
    "You are THE ORACLE, head of the analyst panel. Your three analysts have spoken:",
    "",
    board,
    "",
    `MATCH: ${f.home} vs ${f.away} — ${f.competition}`,
    "",
    "Weigh their disagreement and commit ONE final call. Write in English. Give a single-sentence",
    "synthesis of how you resolved the panel, then output EXACTLY one final line, nothing after it:",
    "VERDICT outcome=<HOME|DRAW|AWAY> score=<H-A> confidence=<0.00-1.00> reason=<=120 chars",
  ].join("\n");
}

export interface PanelResult {
  final: ParsedPrediction;
  panel: DebateEntry[];
  consensus: string;
  judgeInference: InferenceResult; // authoritative provenance for the record
  allTeeValid: boolean;
}

/** Run the full panel debate + judge synthesis for one fixture. */
export async function runPanel(
  broker: ZGComputeNetworkBroker,
  provider: string,
  f: Fixture,
): Promise<PanelResult> {
  const panel: DebateEntry[] = [];
  let allTeeValid = true;

  for (const agent of PANEL) {
    console.log(`    · ${agent.name} reasoning…`);
    const { inf, p, take } = await inferClean(broker, provider, analystPrompt(f, agent.system));
    const teeOk = inf.teeSignatureValid === true;
    allTeeValid = allTeeValid && teeOk;
    panel.push({
      agent: agent.name,
      role: agent.role,
      outcome: p.outcome,
      scoreline: p.scoreline,
      confidence: p.confidence,
      take,
      teeSignatureValid: teeOk,
    });
    console.log(`      → ${p.outcome} ${p.scoreline} (${Math.round(p.confidence * 100)}%)`);
  }

  console.log(`    · The Oracle (judge) synthesizing…`);
  const { inf: judgeInference, p: final, take: consensus } = await inferClean(
    broker,
    provider,
    judgePrompt(f, panel),
  );
  allTeeValid = allTeeValid && judgeInference.teeSignatureValid === true;

  return { final, panel, consensus, judgeInference, allTeeValid };
}

// qwen and other bilingual models sometimes answer in Chinese; keep the public
// record in English.
const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

/** inferAndParse + an English-only retry if the model slips into another script. */
async function inferClean(
  broker: ZGComputeNetworkBroker,
  provider: string,
  prompt: string,
): Promise<{ inf: InferenceResult; p: ParsedPrediction; take: string }> {
  let { inf, p } = await inferAndParse(broker, provider, prompt);
  let take = extractTake(inf.content);
  if (CJK.test(take) || CJK.test(p.rationale)) {
    const eng = prompt + "\n\nIMPORTANT: respond ONLY in English. Do not use any non-English characters.";
    ({ inf, p } = await inferAndParse(broker, provider, eng));
    take = extractTake(inf.content);
  }
  return { inf, p, take };
}

/** Run one inference and parse it; on a parse failure, re-ask once with a nudge. */
async function inferAndParse(
  broker: ZGComputeNetworkBroker,
  provider: string,
  prompt: string,
): Promise<{ inf: InferenceResult; p: ParsedPrediction }> {
  const inf = await runVerifiedInference(broker, provider, prompt);
  try {
    return { inf, p: parsePrediction(inf.content) };
  } catch {
    const nudge =
      prompt +
      "\n\nIMPORTANT: your previous reply was rejected. Output the VERDICT line EXACTLY, " +
      "e.g. `VERDICT outcome=AWAY score=1-0 confidence=0.55 reason=...` as the final line.";
    const retry = await runVerifiedInference(broker, provider, nudge);
    return { inf: retry, p: parsePrediction(retry.content) };
  }
}
