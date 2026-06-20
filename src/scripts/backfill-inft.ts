/**
 * Backfill: mint the soulbound Prediction iNFT for every prediction already
 * committed in OracleRegistry. Idempotent — the contract skips any predictionId
 * already minted. Run once after deploying PredictionINFT:
 *
 *   npx tsx src/scripts/backfill-inft.ts
 */
import { JsonRpcProvider, Wallet } from "ethers";
import { config } from "../config.js";
import { oracleContract, getPrediction } from "../broker/contract.js";
import { mintPredictionINFT, inftConfigured } from "../broker/inft.js";

async function main() {
  if (!inftConfigured()) throw new Error("INFT_CONTRACT_ADDRESS not set in .env");

  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  const wallet = new Wallet(config.privateKey, provider);

  const total = Number(await oracleContract(provider).totalPredictions());
  console.log(`OracleRegistry has ${total} predictions — backfilling iNFTs…`);

  for (let id = 0; id < total; id++) {
    const p = await getPrediction(provider, id);
    try {
      const minted = await mintPredictionINFT(wallet, id, p.recordHash, p.storageRoot);
      if (minted) console.log(`  #${id} → iNFT #${minted.tokenId} (tx ${minted.txHash.slice(0, 12)}…)`);
      else console.log(`  #${id} → already minted, skipped`);
    } catch (e) {
      console.warn(`  #${id} → mint failed: ${(e as Error).message}`);
    }
  }
  console.log("Backfill complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
