import { Contract, Wallet, type JsonRpcProvider } from "ethers";
import { config } from "../config.js";
import { OUTCOME_INDEX, OUTCOME_FROM_INDEX, type Outcome } from "../types.js";

// Minimal ABI — only what the agent calls + the views the frontend reads.
export const ORACLE_ABI = [
  "function commitPrediction(uint256 matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint8 predicted) returns (uint256)",
  "function resolvePrediction(uint256 id, uint8 actual)",
  "function getPrediction(uint256 id) view returns (tuple(uint256 matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint64 committedAt, uint8 predicted, uint8 actual, uint8 status))",
  "function totalPredictions() view returns (uint256)",
  "function correctCount() view returns (uint256)",
  "function resolvedCount() view returns (uint256)",
  "function accuracyBps() view returns (uint256)",
  "function committedMatch(uint256) view returns (bool)",
  "event PredictionCommitted(uint256 indexed id, uint256 indexed matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint8 predicted)",
  "event PredictionResolved(uint256 indexed id, uint8 actual, uint8 status)",
] as const;

export function oracleContract(runner: Wallet | JsonRpcProvider): Contract {
  if (!config.oracleContract || config.oracleContract.startsWith("0x...")) {
    throw new Error("ORACLE_CONTRACT_ADDRESS not set — deploy the contract first.");
  }
  return new Contract(config.oracleContract, ORACLE_ABI, runner);
}

/**
 * 0G Chain rejects EIP-1559 txs whose tip cap is below the minimum, so we send
 * legacy (type-0) txs with an explicit gas price — same fix as the Foundry
 * `--legacy --gas-price` deploy.
 */
async function legacyOverrides(wallet: Wallet): Promise<{ gasPrice: bigint; type: 0 }> {
  const fee = await wallet.provider!.getFeeData();
  const min = 2_000_000_000n; // network minimum observed on Galileo
  const gasPrice = fee.gasPrice && fee.gasPrice > min ? fee.gasPrice : 4_000_000_007n;
  return { gasPrice, type: 0 };
}

/**
 * Commit a prediction. Reverts on-chain if the tx mines at/after kickoff.
 * Returns both the tx hash and the real on-chain prediction id (read from the
 * PredictionCommitted event) so resolution can target it later.
 */
export async function commitPrediction(
  wallet: Wallet,
  matchId: bigint,
  recordHash: string,
  storageRoot: string,
  kickoffUnix: number,
  predicted: Outcome,
): Promise<{ txHash: string; id: number }> {
  const c = oracleContract(wallet);
  const tx = await c.commitPrediction(
    matchId,
    recordHash,
    storageRoot,
    kickoffUnix,
    OUTCOME_INDEX[predicted],
    await legacyOverrides(wallet),
  );
  const receipt = await tx.wait();

  // Recover the assigned prediction id from the emitted event.
  let id = -1;
  for (const log of receipt.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "PredictionCommitted") {
        id = Number(parsed.args.id);
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { txHash: receipt.hash, id };
}

export async function resolvePrediction(
  wallet: Wallet,
  id: bigint,
  actual: Outcome,
): Promise<string> {
  const c = oracleContract(wallet);
  const tx = await c.resolvePrediction(id, OUTCOME_INDEX[actual], await legacyOverrides(wallet));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function alreadyCommitted(
  runner: Wallet | JsonRpcProvider,
  matchId: bigint,
): Promise<boolean> {
  return oracleContract(runner).committedMatch(matchId);
}

/** Current public accuracy in basis points (0..10000). */
export async function accuracyBps(runner: Wallet | JsonRpcProvider): Promise<number> {
  return Number(await oracleContract(runner).accuracyBps());
}

export interface OnChainPrediction {
  id: number;
  matchId: bigint;
  recordHash: string;
  storageRoot: string;
  kickoff: number;
  committedAt: number;
  predicted: Outcome;
  actual: Outcome;
  status: "Pending" | "Correct" | "Wrong";
}

const STATUS = ["Pending", "Correct", "Wrong"] as const;

/** Read one prediction back from chain (used by resolution + diagnostics). */
export async function getPrediction(
  runner: Wallet | JsonRpcProvider,
  id: number,
): Promise<OnChainPrediction> {
  const p = await oracleContract(runner).getPrediction(id);
  return {
    id,
    matchId: p.matchId,
    recordHash: p.recordHash,
    storageRoot: p.storageRoot,
    kickoff: Number(p.kickoff),
    committedAt: Number(p.committedAt),
    predicted: OUTCOME_FROM_INDEX[Number(p.predicted)],
    actual: OUTCOME_FROM_INDEX[Number(p.actual)],
    status: STATUS[Number(p.status)],
  };
}
