# Building on 0G — an honest field report

A warts-and-all log of shipping **The Oracle** end-to-end on 0G Galileo testnet
(chain id `16602`): TEE inference → 0G Storage → pre-kickoff on-chain commit →
soulbound iNFT → client-side verification. Everything here is firsthand. Each item is
**symptom → cause → fix**, with the fix in this repo so you can copy it. The point isn't
to dunk on 0G — the core primitives are genuinely good (see the end) — it's to save the
next builder the days these cost us.

> TL;DR: the cryptography works; the SDKs/docs lag the deployed contracts, and the
> compute layer is thin on testnet. Plan for both.

---

## 1. The 0G Storage SDK is behind the deployed Flow contract (the big one)

**Symptom.** `Indexer.upload(...)` reverts with a bare `require(false)` / `0x` — no
message, no decodable error.

**Cause.** The published `@0glabs/0g-ts-sdk` (0.3.3, latest at build time) calls the old
`submit(Submission)` selector `0xef3e12dc`. The live Galileo Flow contract
(`0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`) upgraded `submit` to wrap the struct with
the sender address — `submit((Submission,address))`, selector `0xbc8c11f8`. The SDK is
calling a function that no longer exists with that shape.

**Fix.** Build the uploader the SDK way, then override *only* the `submit` call with the
correct ABI (the `Submit` event and segment-upload flow are unchanged). See
[`src/broker/storage.ts`](src/broker/storage.ts). Reverse-engineer the current selector
from a recent successful tx with `cast` if it drifts again. **Remove the shim once 0G ships
an SDK that targets the current contract.**

## 2. Chain id changed: 16601 → 16602

**Symptom.** `createZGComputeNetworkBroker` throws `NETWORK_ERROR` / "network changed";
ethers refuses to send.

**Cause.** Galileo's chain id moved to **16602**. Stale config (or stale docs) say 16601.

**Fix.** Pin `16602` everywhere — config, the frontend `JsonRpcProvider`, and `foundry.toml`.

## 3. The compute ledger has a hard 3-OG minimum

**Symptom.** `addLedger(1)` fails: *"Minimum balance to create a ledger is 3 0G."*

**Cause.** Contract-enforced floor, not configurable.

**Fix.** Initialize the ledger with **3 OG** and keep the wallet funded above it. We made
the init amount a config value (`LEDGER_INIT_AMOUNT`, default 3) rather than hard-coding.

## 4. 0G Chain rejects EIP-1559 txs below the tip-cap minimum

**Symptom.** Both Foundry deploys and ethers txs fail: *"gas tip cap 1, minimum needed
2000000000."*

**Cause.** The chain requires a minimum priority fee that the default 1559 estimation
undershoots.

**Fix.** Send **legacy (type-0)** txs with an explicit gas price. Foundry:
`--legacy --gas-price 4000000007`. ethers: force `{ type: 0, gasPrice }` (see the
`legacyOverrides` helper in [`src/broker/contract.ts`](src/broker/contract.ts) and
[`src/broker/inft.ts`](src/broker/inft.ts)).

## 5. Compute is thin on testnet — one provider, one model family

**Symptom.** `broker.inference.listService()` returns essentially **Qwen only**
(`qwen/qwen2.5-omni-7b` for text; the other listed provider is an image model with no
`/chat/completions` → 404). No DeepSeek, no choice of text models.

**Cause.** The decentralized compute marketplace is early; few providers are live on
testnet.

**Fix.** Don't design around model variety yet. Pin the known-good text provider
(`0xa48f01287233509FD694a22Bf840225062E67836`) and treat model availability as a moving
target. The TEE *verification* path is solid even though the *menu* is small.

## 6. Provider endpoints + RPC are flaky under load

**Symptom.** `ECONNRESET` / "socket hang up" mid-inference; and from the RPC,
`eth_getTransactionReceipt` returning *"no matching receipts found: this may indicate
potential data corruption"* right after a tx lands.

**Cause.** Testnet provider uptime and an RPC that sometimes can't find a receipt it just
produced (eventual consistency, not actual corruption).

**Fix.** Wrap every SDK/RPC call in bounded retry with backoff (`withRetry` in
[`src/broker/compute.ts`](src/broker/compute.ts)), and make every on-chain script
**idempotent** so a re-run after a dropped connection is safe. Our iNFT backfill
([`src/scripts/backfill-inft.ts`](src/scripts/backfill-inft.ts)) survived an ECONNRESET
mid-run precisely because the contract guards against double-mint and the script just
re-runs.

## 7. ENS resolution on placeholder addresses

**Symptom.** `UNSUPPORTED_OPERATION` — ethers tries to ENS-resolve a `0x...` placeholder
left in `.env`.

**Cause.** An unset/placeholder address gets treated as a name to resolve; 0G has no ENS.

**Fix.** Guard for placeholder/empty addresses before constructing contracts; fail with a
clear "set this env var" message instead.

## 8. The model writes the judge synthesis in Chinese

**Symptom.** The qwen2.5-omni judge occasionally returns its synthesis in CJK.

**Fix.** Detect CJK in the output and re-ask English-only (`inferClean`), and harden the
parser with a lenient fallback so a persona that ignores the strict format still parses.

---

## What 0G genuinely got right

Credit where due — these are the reasons the project works at all:

- **TEE-verified inference is real and usable.** `processResponse` validates the provider's
  signature; we get `teeSignatureValid: true` deterministically. That's the load-bearing
  primitive and it delivers.
- **The Storage gateway is CORS-open.** `…/file?root=<hash>` returns the exact uploaded
  bytes with `Access-Control-Allow-Origin: *`, which is what makes our **entirely
  client-side** Verify button possible — the browser re-fetches the record and recomputes
  the hash with zero server trust.
- **Content-addressed storage + a thin on-chain hash** is the right split: the full record
  lives off-chain, only `keccak256(canonicalJSON(record))` goes on-chain, and the two are
  cryptographically tied.

## Reproduce

```bash
npm run probe:tee                 # de-risk the TEE path first — want teeSignatureValid: true
npm run agent -- --once --all     # full pipeline against the sample fixtures
```

All fixes referenced above live in [`src/broker/`](src/broker/) and
[`src/scripts/`](src/scripts/). PRs welcome if 0G ships SDK updates that let us delete the
shims.
