import { readFileSync, existsSync } from "node:fs";
import { config } from "../config.js";
import type { Outcome } from "../types.js";
import type { Fixture } from "../agent/predict.js";

const COMPETITION = process.env.FOOTBALL_COMPETITION ?? "WC"; // World Cup
const FIXTURES_PATH = process.env.FIXTURES_PATH ?? "data/fixtures.json";

interface FDMatch {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  competition?: { name: string };
  score?: { winner?: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null };
}

function hasApiKey(): boolean {
  return Boolean(config.footballApiKey && config.footballApiKey.length > 0);
}

async function fd(path: string): Promise<FDMatch[]> {
  const res = await fetch(`${config.footballApiBase}${path}`, {
    headers: { "X-Auth-Token": config.footballApiKey },
  });
  if (!res.ok) {
    throw new Error(`football-data ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { matches?: FDMatch[] };
  return body.matches ?? [];
}

/** Stable, collision-free match id derived from the data provider's id. */
function matchIdFor(m: FDMatch): string {
  return `fd-${COMPETITION.toLowerCase()}-${m.id}`;
}

function toFixture(m: FDMatch): Fixture {
  return {
    matchId: matchIdFor(m),
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    competition: m.competition?.name ?? "FIFA World Cup 2026",
    kickoffUtc: m.utcDate,
    context: `Scheduled fixture from football-data.org (${COMPETITION}).`,
  };
}

function winnerToOutcome(w: FDMatch["score"]): Outcome | null {
  switch (w?.winner) {
    case "HOME_TEAM":
      return "HOME";
    case "AWAY_TEAM":
      return "AWAY";
    case "DRAW":
      return "DRAW";
    default:
      return null;
  }
}

/** Upcoming fixtures. Falls back to the local fixtures file with no API key. */
export async function getUpcomingFixtures(): Promise<Fixture[]> {
  if (!hasApiKey()) {
    if (!existsSync(FIXTURES_PATH)) return [];
    return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Fixture[];
  }
  const matches = await fd(`/competitions/${COMPETITION}/matches?status=SCHEDULED,TIMED`);
  return matches.map(toFixture);
}

/** Finished results keyed by our matchId — used by the resolution pipeline. */
export async function getFinishedResults(): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>();
  if (!hasApiKey()) {
    // Local mode: read optional results overrides for testing resolution.
    const resultsPath = process.env.RESULTS_PATH ?? "data/results.json";
    if (existsSync(resultsPath)) {
      const rows = JSON.parse(readFileSync(resultsPath, "utf8")) as {
        matchId: string;
        outcome: Outcome;
      }[];
      for (const r of rows) out.set(r.matchId, r.outcome);
    }
    return out;
  }
  const matches = await fd(`/competitions/${COMPETITION}/matches?status=FINISHED`);
  for (const m of matches) {
    const o = winnerToOutcome(m.score);
    if (o) out.set(matchIdFor(m), o);
  }
  return out;
}
