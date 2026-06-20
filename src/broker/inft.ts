import { Contract, Wallet, type JsonRpcProvider } from "ethers";
import { config } from "../config.js";

// Minimal ABI — mint (agent) + the views the frontend/MCP read.
export const INFT_ABI = [
  "function mint(uint256 predictionId, bytes32 storageRoot, bytes32 recordHash, string uri) returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function agentDid() view returns (string)",
  "function tokenOfPrediction(uint256 predictionId) view returns (uint256)",
  "function mintedForPrediction(uint256 predictionId) view returns (bool)",
  "function meta(uint256 tokenId) view returns (uint256 predictionId, bytes32 storageRoot, bytes32 recordHash, uint64 mintedAt)",
  "event PredictionMinted(uint256 indexed tokenId, uint256 indexed predictionId, bytes32 storageRoot, bytes32 recordHash)",
] as const;

export function inftConfigured(): boolean {
  return !!config.inftContract && !config.inftContract.startsWith("0x...");
}

export function inftContract(runner: Wallet | JsonRpcProvider): Contract {
  if (!inftConfigured()) {
    throw new Error("INFT_CONTRACT_ADDRESS not set — deploy PredictionINFT first.");
  }
  return new Contract(config.inftContract, INFT_ABI, runner);
}

/** 0G Chain rejects EIP-1559 tip caps below the minimum — send legacy type-0. */
async function legacyOverrides(wallet: Wallet): Promise<{ gasPrice: bigint; type: 0 }> {
  const fee = await wallet.provider!.getFeeData();
  const min = 2_000_000_000n;
  const gasPrice = fee.gasPrice && fee.gasPrice > min ? fee.gasPrice : 4_000_000_007n;
  return { gasPrice, type: 0 };
}

/** The 0G Storage gateway URL for a record root — used as the tokenURI. */
export function recordGatewayUrl(storageRoot: string): string {
  return `${config.storageIndexerUrl}/file?root=${storageRoot}`;
}

/**
 * Mint the soulbound iNFT for a prediction. Best-effort: callers should wrap
 * this so a mint failure never aborts the (already-committed) prediction.
 * Returns the new token id, or null if already minted for this prediction.
 */
export async function mintPredictionINFT(
  wallet: Wallet,
  predictionId: number,
  recordHash: string,
  storageRoot: string,
): Promise<{ tokenId: number; txHash: string } | null> {
  const c = inftContract(wallet);
  if (await c.mintedForPrediction(predictionId)) return null;

  const tx = await c.mint(
    predictionId,
    storageRoot,
    recordHash,
    recordGatewayUrl(storageRoot),
    await legacyOverrides(wallet),
  );
  const receipt = await tx.wait();

  let tokenId = -1;
  for (const log of receipt.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "PredictionMinted") {
        tokenId = Number(parsed.args.tokenId);
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { tokenId, txHash: receipt.hash };
}
