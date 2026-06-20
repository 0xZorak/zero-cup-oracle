/**
 * The whole verifiability story rests on ONE invariant: the agent's
 * canonicalization (src/canonical.ts) and the browser's (frontend/app.js
 * `sortDeep` + `canonicalJSON`) must produce BYTE-IDENTICAL output, so the hash
 * the browser recomputes equals the hash committed on-chain. This test pins that
 * invariant by re-implementing the frontend algorithm verbatim and asserting it
 * matches the agent — including the cases most likely to drift (unicode/CJK, key
 * ordering, nesting, numbers).
 *
 * Run: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalJSON, recordHash } from "./canonical.js";
import type { PredictionRecord } from "./types.js";

// ── verbatim copy of the FRONTEND algorithm (frontend/app.js) ──
// If you change one, this test forces you to change the other.
function frontendSortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(frontendSortDeep);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort())
      o[k] = frontendSortDeep((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}
const frontendCanonical = (v: unknown) => JSON.stringify(frontendSortDeep(v));
const frontendHash = (v: unknown) => keccak256(toUtf8Bytes(frontendCanonical(v)));

// A representative record with keys deliberately OUT of sorted order, nested
// objects/arrays, a CJK string (the exact failure mode we hit on predictions
// #6/#7), and fractional + integer numbers.
const record: PredictionRecord = {
  schemaVersion: "1.0",
  provenance: {
    teeSignatureValid: true,
    model: "qwen/qwen2.5-omni-7b",
    provider: "0xa48f01287233509FD694a22Bf840225062E67836",
    chatId: "ZG-Res-Key-abc",
    verificationMode: "TeeML",
    attestationRef: "data/attestations/wc2026-m63.json",
  },
  agentId: "did:0g:0xaa61388fbDd6e557a8Fb2E02393B311AcEA27B6f",
  match: {
    id: "wc2026-m63",
    home: "Belgium",
    away: "USA",
    competition: "FIFA World Cup 2026",
    kickoffUtc: "2026-07-02T23:00:00.000Z",
  },
  prediction: { outcome: "AWAY", scoreline: "1-0", confidence: 0.6, rationale: "Tactical edge." },
  debate: {
    consensus: "The panel分歧在于战术优势与年龄劣势。最终，我选择了比利时客场1-0获胜。",
    panel: [
      { agent: "The Statistician", role: "cold numbers", outcome: "HOME", scoreline: "2-1", confidence: 0.55, take: "Belgium's talent.", teeSignatureValid: true },
      { agent: "The Contrarian", role: "hunts the upset", outcome: "AWAY", scoreline: "1-0", confidence: 0.5, take: "USA at home.", teeSignatureValid: true },
    ],
  },
  createdAtUtc: "2026-06-18T21:00:00.000Z",
  dataSources: ["football-data.org"],
};

test("agent and frontend canonical JSON are byte-identical", () => {
  assert.equal(canonicalJSON(record), frontendCanonical(record));
});

test("agent and frontend recordHash match", () => {
  assert.equal(recordHash(record), frontendHash(record));
});

test("key order does not affect the hash", () => {
  const reordered = { match: record.match, prediction: record.prediction, ...record };
  assert.equal(recordHash(record), recordHash(reordered));
});

test("CJK / unicode survives canonicalization identically", () => {
  const r = { note: "比利时 1-0 — café — 日本", n: 0.6 };
  assert.equal(canonicalJSON(r), frontendCanonical(r));
  assert.equal(recordHash(r), frontendHash(r));
});

test("a single byte change flips the hash (no accidental collisions)", () => {
  const tweaked = { ...record, prediction: { ...record.prediction, scoreline: "2-0" } };
  assert.notEqual(recordHash(record), recordHash(tweaked));
});
