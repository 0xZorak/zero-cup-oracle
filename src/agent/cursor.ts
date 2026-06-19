import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const CURSOR_PATH = "data/cursor.json";

interface PredictedEntry {
  id: number;
  recordHash: string;
  txHash: string;
  home?: string;
  away?: string;
}

interface Cursor {
  predicted: Record<string, PredictedEntry>;
  resolved: Record<string, { txHash: string; actual: string }>;
}

function load(): Cursor {
  if (!existsSync(CURSOR_PATH)) return { predicted: {}, resolved: {} };
  return JSON.parse(readFileSync(CURSOR_PATH, "utf8")) as Cursor;
}

function save(c: Cursor): void {
  mkdirSync(dirname(CURSOR_PATH), { recursive: true });
  writeFileSync(CURSOR_PATH, JSON.stringify(c, null, 2));
}

/** Idempotency: never predict or resolve the same match twice. */
export const cursor = {
  isPredicted: (matchId: string) => matchId in load().predicted,
  isResolved: (matchId: string) => matchId in load().resolved,
  markPredicted(matchId: string, v: PredictedEntry) {
    const c = load();
    c.predicted[matchId] = v;
    save(c);
  },
  markResolved(matchId: string, v: { txHash: string; actual: string }) {
    const c = load();
    c.resolved[matchId] = v;
    save(c);
  },
  predictionId(matchId: string): number | undefined {
    return load().predicted[matchId]?.id;
  },
  getPredicted(matchId: string): PredictedEntry | undefined {
    return load().predicted[matchId];
  },
};
