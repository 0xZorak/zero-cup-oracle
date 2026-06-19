import { ethers, Wallet } from "ethers";
import {
  createZGComputeNetworkBroker,
  type ZGComputeNetworkBroker,
} from "@0glabs/0g-serving-broker";
import { config } from "../config.js";

export interface InferenceResult {
  /** The model's raw text answer. */
  content: string;
  /** ZG-Res-Key — the chat ID needed to verify the TEE signature. */
  chatId: string;
  /** Whether the TEE signature over this response verified. null = no signer/unknown. */
  teeSignatureValid: boolean | null;
  model: string;
  provider: string;
  endpoint: string;
}

/** Build a wallet + broker bound to the 0G network from the signer's provider. */
export async function makeBroker(): Promise<{ wallet: Wallet; broker: ZGComputeNetworkBroker }> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = new Wallet(config.privateKey, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  return { wallet, broker };
}

/**
 * Ensure the agent's 0G Compute ledger has enough balance, topping itself up if
 * not. This is the "it buys its own compute" demo beat — same wallet that signs
 * the on-chain commits. Node-side auto-funding handles provider sub-accounts.
 */
export async function ensureLedger(broker: ZGComputeNetworkBroker): Promise<void> {
  try {
    const ledger = await broker.ledger.getLedger();
    const balance = Number(ethers.formatEther(ledger.totalBalance ?? 0n));
    if (balance < config.ledgerMinBalance) {
      await broker.ledger.depositFund(config.ledgerTopupAmount);
    }
  } catch {
    // No ledger yet — create one. Minimum required by the contract is 3 OG.
    await broker.ledger.addLedger(config.ledgerInitAmount);
  }
}

/**
 * Run one Direct-path inference inside the provider's TEE and verify the
 * returned signature. The TEE signature IS the product — it proves a genuine
 * enclave produced this prediction, untampered.
 */
export async function runVerifiedInference(
  broker: ZGComputeNetworkBroker,
  provider: string,
  prompt: string,
): Promise<InferenceResult> {
  // One-time: tell the contract we trust this provider's TEE signer.
  await broker.inference.acknowledgeProviderSigner(provider).catch(() => {
    /* already acknowledged — non-fatal */
  });

  // The provider endpoint is flaky (ECONNRESET / socket hang up), so retry the
  // metadata + header fetch as well as the inference call itself.
  const { endpoint, model } = await withRetry(() =>
    broker.inference.getServiceMetadata(provider),
  );
  const headers = await withRetry(() => broker.inference.getRequestHeaders(provider, prompt));

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  const res = await withRetry(() =>
    fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers as unknown as Record<string, string>),
      },
      body,
    }),
  );

  if (!res.ok) {
    throw new Error(`Inference HTTP ${res.status}: ${await res.text()}`);
  }

  // The chat ID (ZG-Res-Key) comes back in a response header; name varies by
  // provider build, so check the known candidates.
  const chatId =
    res.headers.get("zg-res-key") ??
    res.headers.get("ZG-Res-Key") ??
    res.headers.get("x-zg-res-key") ??
    "";

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";

  // The verification surface: confirm the TEE signature over the response.
  const teeSignatureValid = await broker.inference.processResponse(provider, chatId, content);

  return { content, chatId, teeSignatureValid, model, provider, endpoint };
}

/** Retry a transient-failing async op (ECONNRESET, socket hang up, TLS drops). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts) break;
      console.log(`  network attempt ${i} failed (${(e as Error).message}), retrying…`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}
