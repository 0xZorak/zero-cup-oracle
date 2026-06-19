import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import { Contract, Wallet } from "ethers";
import { config } from "../config.js";
import { canonicalJSON } from "../canonical.js";

export interface StorageUploadResult {
  rootHash: string;
  txHash: string;
}

// The deployed Galileo Flow contract upgraded `submit` to wrap the Submission
// struct together with the sender address in a tuple:
//   submit(((uint256,bytes,(bytes32,uint256)[]),address))   selector 0xbc8c11f8
// The published TS SDK (0.3.3, latest) still calls the old single-arg
// `submit(Submission)` (0xef3e12dc), which no longer exists on-chain and reverts
// with `require(false)`. Everything else in the SDK — submission building, the
// `Submit` event, segment upload — is unchanged, so we only override the submit
// call. Remove this shim once 0G ships an SDK that targets the current contract.
const NEW_FLOW_ABI = [
  "function submit(((uint256,bytes,(bytes32,uint256)[]),address)) payable returns (uint256,bytes32,uint256,uint256)",
];

/**
 * Upload the canonical prediction record to 0G Storage. Returns the rootHash,
 * which is what we commit on-chain. We upload the SAME canonical bytes the
 * frontend will fetch and re-hash, so the integrity check reproduces exactly.
 */
export async function uploadRecord(
  wallet: Wallet,
  record: unknown,
): Promise<StorageUploadResult> {
  const bytes = new TextEncoder().encode(canonicalJSON(record));
  const file = new MemData(bytes);

  const indexer = new Indexer(config.storageIndexerUrl);
  // The storage SDK bundles its own ethers build; cast across the version skew.
  const signer = wallet as unknown as Parameters<typeof indexer.upload>[2];

  // Build the uploader the SDK way, then patch its flow contract's `submit`.
  const [uploader, upErr] = await (indexer as any).newUploaderFromIndexerNodes(
    config.rpcUrl,
    signer,
    1, // expectedReplica
  );
  if (upErr !== null || uploader == null) {
    throw new Error(`0G Storage: failed to build uploader: ${upErr}`);
  }

  const sender = await wallet.getAddress();
  const flowAddr: string = await uploader.flow.getAddress();
  const newFlow = new Contract(flowAddr, NEW_FLOW_ABI, wallet);
  const realFlow = uploader.flow;

  // Intercept only getFunction('submit'); delegate everything else (market(),
  // getAddress(), interface for event parsing) to the real SDK flow contract.
  uploader.flow = new Proxy(realFlow, {
    get(target, prop, recv) {
      if (prop === "getFunction") {
        return (name: string) => {
          if (name !== "submit") return target.getFunction(name);
          return {
            send: async (submission: any, txOpts: any) => {
              const sub = [
                submission.length,
                submission.tags,
                submission.nodes.map((n: any) => [n.root, n.height]),
              ];
              return newFlow.submit([sub, sender], txOpts);
            },
          };
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  const uploadOpts = {
    tags: "0x",
    finalityRequired: true,
    taskSize: 10,
    expectedReplica: 1,
    skipTx: false,
    fee: 0n, // auto-calculate exact fee (sectors × pricePerSector)
  };
  const [res, err] = await uploader.uploadFile(file, uploadOpts);
  if (err !== null) {
    throw new Error(`0G Storage upload failed: ${err.message ?? err}`);
  }
  return { rootHash: res.rootHash, txHash: res.txHash };
}
