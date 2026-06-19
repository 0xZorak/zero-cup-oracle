import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Deterministic JSON canonicalization: object keys sorted recursively, no
 * insignificant whitespace. The frontend MUST reproduce this byte-for-byte to
 * recompute the hash and match the on-chain commit — that re-derivation with no
 * trust in our server is the whole verifiability story.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** recordHash = keccak256(canonicalJSON(record)) — exactly what commitPrediction stores. */
export function recordHash(record: unknown): string {
  return keccak256(toUtf8Bytes(canonicalJSON(record)));
}
