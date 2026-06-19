import { config } from "../config.js";
import type { Fixture } from "./predict.js";

const COMPETITION = process.env.FOOTBALL_COMPETITION ?? "WC";

interface TableRow {
  position: number;
  points: number;
  goalDifference: number;
  form?: string; // e.g. "W,W,D,L,W"
  team?: { name?: string; shortName?: string };
}

/**
 * The Scout step: before the panel reasons, enrich the fixture with real recent
 * form + standings so the agents argue over data, not vibes. This is the quality
 * lever — better visible accuracy on the public scoreboard. Needs a
 * football-data API key; with none it's a clean no-op (context unchanged).
 */
export async function scoutFixture(f: Fixture): Promise<Fixture> {
  if (!config.footballApiKey) return f;
  try {
    const res = await fetch(`${config.footballApiBase}/competitions/${COMPETITION}/standings`, {
      headers: { "X-Auth-Token": config.footballApiKey },
    });
    if (!res.ok) return f;
    const body = (await res.json()) as { standings?: { table?: TableRow[] }[] };

    const rows: TableRow[] = [];
    for (const s of body.standings ?? []) for (const r of s.table ?? []) rows.push(r);
    const find = (name: string) =>
      rows.find((r) => r.team?.name === name || r.team?.shortName === name);

    const fmt = (r?: TableRow) =>
      r
        ? `pos ${r.position}, ${r.points}pts, GD ${r.goalDifference >= 0 ? "+" : ""}${r.goalDifference}, recent ${r.form ?? "?"}`
        : "no table data";

    const h = find(f.home);
    const a = find(f.away);
    if (!h && !a) return f;

    const extra = `Form/standings — ${f.home}: ${fmt(h)}. ${f.away}: ${fmt(a)}.`;
    console.log(`  [scout] enriched ${f.home} v ${f.away} with live standings`);
    return {
      ...f,
      context: [f.context, extra].filter(Boolean).join(" "),
    };
  } catch {
    return f; // research is best-effort; never block a prediction
  }
}
