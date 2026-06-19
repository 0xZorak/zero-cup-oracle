/**
 * THE RISK PROBE. Run this first, this week.
 *
 *   npm run probe:tee
 *
 * It exercises the entire hard path end-to-end with no football data, no
 * storage, no contract — just: wallet → ledger → Direct inference → TEE verify.
 * If this prints `teeSignatureValid: true`, the rest of the build is plumbing.
 * If it doesn't, you've found the only thing that can sink your run, while you
 * still have days to fix it.
 */
import { ethers } from "ethers";
import { config } from "../config.js";
import { makeBroker, ensureLedger, runVerifiedInference } from "../broker/compute.js";

async function main() {
  console.log("→ Connecting wallet + broker...");
  const { wallet, broker } = await makeBroker();
  const addr = await wallet.getAddress();
  const bal = await wallet.provider!.getBalance(addr);
  console.log(`  agent wallet: ${addr}`);
  console.log(`  OG balance:   ${ethers.formatEther(bal)} OG`);

  console.log("→ Listing providers...");
  const services = await broker.inference.listService();
  for (const s of services.slice(0, 10)) {
    console.log(`  provider=${s.provider}  model=${(s as any).model ?? "?"}`);
  }
  if (services.length === 0) throw new Error("No providers returned by listService().");

  const provider = (config.computeProvider && !config.computeProvider.startsWith("0x..."))
    ? config.computeProvider
    : services[0].provider;
  console.log(`→ Using provider: ${provider}`);

  console.log("→ Ensuring ledger funded (self-funding)...");
  await ensureLedger(broker);

  // Top up the ledger so the auto-funder can transfer into the provider sub-account.
  // If the available balance < 1 OG the SDK warns and inference may fail.
  try {
    const ledger = await broker.ledger.getLedger();
    const avail = Number(ethers.formatEther(ledger.totalBalance ?? 0n));
    console.log(`  ledger balance: ${avail} OG`);
    if (avail < 1) {
      console.log("  topping up ledger by 1 OG...");
      await broker.ledger.depositFund(1);
    }
  } catch (e) {
    console.warn("  could not read ledger balance:", (e as Error).message);
  }

  const prompt =
    "You are a football analyst. In one sentence, who is more likely to win a " +
    "neutral-site match between Morocco and Senegal, and why? End with: OUTCOME=HOME|DRAW|AWAY.";

  console.log("→ Running Direct inference inside the TEE...");
  const r = await runVerifiedInference(broker, provider, prompt);

  console.log("\n──────── RESULT ────────");
  console.log("model:              ", r.model);
  console.log("chatId (ZG-Res-Key):", r.chatId || "(empty — check header name!)");
  console.log("teeSignatureValid:  ", r.teeSignatureValid);
  console.log("content:\n", r.content);
  console.log("────────────────────────");

  if (r.teeSignatureValid === true) {
    console.log("\n✅ TEE path works. The hard part is de-risked.");
  } else {
    console.log("\n⚠️  TEE signature NOT confirmed. Investigate before building further.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\n❌ Probe failed:", e);
  process.exit(1);
});
