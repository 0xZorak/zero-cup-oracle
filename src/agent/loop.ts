import cron from "node-cron";
import { config } from "../config.js";
import { makeBroker, ensureLedger } from "../broker/compute.js";
import { predictMatch } from "./predictMatch.js";
import { resolveTick } from "./resolve.js";
import { getUpcomingFixtures } from "../data/football.js";

/** Predict every fixture whose kickoff is within the lookahead window. */
async function predictTick() {
  const { wallet, broker } = await makeBroker();
  await ensureLedger(broker);
  const provider = config.computeProvider;
  if (!provider || provider.startsWith("0x...")) {
    throw new Error("COMPUTE_PROVIDER_ADDRESS not set — run `npm run probe:tee` to list providers.");
  }

  const now = Date.now();
  const lookaheadMs = 1000 * 60 * 60 * 6; // predict matches kicking off within 6h
  const forceAll = process.argv.includes("--all");
  const fixtures = await getUpcomingFixtures();
  const due = fixtures.filter((f) => {
    const k = new Date(f.kickoffUtc).getTime();
    if (forceAll) return k > now; // skip only past matches
    return k > now && k - now <= lookaheadMs;
  });

  console.log(`[predict ${new Date().toISOString()}] ${due.length}/${fixtures.length} fixture(s) due`);
  for (const f of due) {
    try {
      const r = await predictMatch(wallet, broker, provider, f);
      if (r.skipped) console.log(`  ↳ ${f.matchId}: skipped (${r.skipped})`);
    } catch (e) {
      console.error(`  ✗ ${f.matchId}:`, (e as Error).message);
    }
  }
}

/** Resolve any finished matches we predicted. */
async function resolveOnly() {
  const { wallet } = await makeBroker();
  await resolveTick(wallet);
}

async function tick() {
  await predictTick();
  const { wallet } = await makeBroker();
  await resolveTick(wallet);
}

const args = process.argv.slice(2);
if (args.includes("--resolve")) {
  resolveOnly().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else if (args.includes("--once")) {
  tick().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log("Oracle loop started. Predict every 10 min, resolve every 15 min. (--once / --resolve for one-shot)");
  tick().catch(console.error);
  cron.schedule("*/10 * * * *", () => predictTick().catch(console.error));
  cron.schedule("*/15 * * * *", () => resolveOnly().catch(console.error));
}
