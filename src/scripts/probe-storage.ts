/** Isolation test for the 0G Storage submit override. */
import { ethers, Wallet } from "ethers";
import { config } from "../config.js";
import { uploadRecord } from "../broker/storage.js";

async function main() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = new Wallet(config.privateKey, provider);

  const record = {
    hello: "0g",
    note: "storage submit override test",
    at: new Date().toISOString(),
  };

  console.log("Uploading test record via patched submit…");
  const res = await uploadRecord(wallet, record);
  console.log(`✅ root=${res.rootHash}\n   tx=${res.txHash}`);
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
