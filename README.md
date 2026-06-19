# The Oracle — Verifiable World Cup Predictions on 0G

**▶ Live demo: https://frontend-five-kappa-63.vercel.app/** — open it, click **Verify** on any
prediction, and watch the integrity check run in your own browser (no wallet, no install).
(Mirror: https://0xzorak.github.io/zero-cup-oracle/)

> Redeploy the frontend after edits:
> - **Vercel (primary):** `cd frontend && vercel deploy --prod --yes`
> - **GitHub Pages (mirror):** `git subtree push --prefix frontend origin gh-pages`

An autonomous agent that predicts each World Cup match **before kickoff**, runs the
reasoning through **0G Compute's TEE-backed inference**, writes the prediction to
**0G Storage**, and commits its hash on **0G Chain** *before the ball is kicked* — then
resolves the result and updates a public, un-fakeable accuracy scoreboard.

Two claims, kept separate:

1. **Integrity** (what 0G proves): this prediction was produced by a genuine model inside
   a TEE, untampered, and existed before kickoff.
2. **Quality** (what the scoreboard proves over time): the predictions are actually good.

> Built for the **0G Zero Cup**. 0G provides essential functionality — compute (TEE
> inference), storage (the record), and chain (the pre-kickoff commit + scoreboard) are
> all load-bearing, not supplementary.

## Why it can't be faked

Anyone can claim they predicted a result after the fact. This agent can't:

- The prediction is produced **inside a TEE** and the response carries a signature the
  broker verifies (`processResponse`). The model genuinely produced it, untampered.
- The full record sits in **0G Storage**; only its `keccak256(canonicalJSON(record))`
  goes on-chain.
- The on-chain `commitPrediction` **reverts unless it mines before kickoff**. The block
  timestamp is the proof of "called it first."
- The frontend re-derives all of this **client-side**, trusting nothing on our server.

## Repo layout

```
src/
  broker/compute.ts     # 0G Compute Direct path + TEE verification (the hard part)
  broker/storage.ts     # 0G Storage upload (incl. the submit-ABI shim, see note)
  broker/contract.ts    # ethers client for the on-chain registry
  data/football.ts      # football-data.org v4 adapter (fixtures + results)
  agent/panel.ts        # the multi-agent debate: 3 analysts + a judge, each in a TEE
  agent/predict.ts      # personas + robust prediction parser (strict + lenient)
  agent/predictMatch.ts # full pre-kickoff pipeline for one match
  agent/resolve.ts      # post-match resolution → updates on-chain accuracy
  agent/loop.ts         # node-cron scheduler (predict + resolve), idempotent
  agent/cursor.ts       # local cursor — never double-commit/resolve
  social/x.ts           # OAuth 1.0a auto-posting (pre-match + post-match receipt)
  canonical.ts          # deterministic JSON + keccak256 (frontend must match)
  scripts/probe-tee.ts  # ⚠️ run this FIRST — de-risks the TEE path standalone
contracts/
  src/OracleRegistry.sol # thin registry + scoreboard, accuracy in basis points
frontend/
  index.html            # glassmorphic "Oracle OS" desktop (blur backdrop on popups)
  app.js                # chain reads + Verify modal (shows the panel debate)
  game.js               # "Beat the Oracle" pick'em game
  chat.js               # "Ask the Oracle" — client-side agent over the stored records
  config.js             # contract address, RPC, 0G gateway + explorers (no keys)
```

### The agents

The Oracle isn't one model — it's a **panel**. For each match, three analyst agents
(The Statistician, The Tactician, The Contrarian) each reason inside their own TEE
inference, then a **judge** agent ("The Oracle") weighs the disagreement and commits one
verdict. The full debate is stored on 0G alongside the call and shown in the Verify card.
A second, client-side **chat agent** ("Ask the Oracle") answers visitor questions from the
stored records — no keys, runs entirely in the browser.

### Two roles — only the operator touches npm

- **Operator (you):** runs the agent (`npm run agent`) that *produces* predictions.
  Needs Node + the private key. Host it on any always-on Node box.
- **Visitor (everyone else):** just opens the website. No install, no wallet, no keys —
  the scoreboard, Verify button, and game all run read-only against public 0G RPC + the
  0G Storage gateway, entirely in the browser.

To ship it to end users: deploy `frontend/` (a static folder) to Vercel / Netlify /
Cloudflare Pages / 0G Studio — one click, free — and point `frontend/config.js` at your
deployed contract. That URL is all a visitor ever needs.

### Known caveat — 0G Storage SDK is behind the deployed contract

The published `@0glabs/0g-ts-sdk` (0.3.3, latest) calls the old `submit(Submission)`
selector, but the live Galileo Flow contract upgraded `submit` to wrap the struct with
the sender address (`submit((Submission,address))`, selector `0xbc8c11f8`). The old call
reverts with a bare `require(false)`. Only the function changed — the `Submit` event and
segment-upload flow are identical — so [storage.ts](src/broker/storage.ts) builds the
uploader the SDK way, then overrides just the `submit` call with the correct ABI. Remove
the shim once 0G ships an SDK that targets the current contract.

## Quick start

```bash
npm install
cp .env.example .env        # fill in PRIVATE_KEY (a funded 0G testnet wallet)

# 1. De-risk the hard part FIRST — wallet → ledger → TEE inference → verify:
npm run probe:tee
#    Want: teeSignatureValid: true

# 2. Deploy the registry (needs Foundry: https://getfoundry.sh):
cd contracts
forge test                                  # contract unit tests
forge script script/Deploy.s.sol --rpc-url og_testnet --broadcast --private-key $PRIVATE_KEY
#    paste the printed address into .env as ORACLE_CONTRACT_ADDRESS

# 3. (optional) preview the social posts — dry-run prints, no creds needed:
npm run probe:x

# 4. Run one tick of the full pipeline against the sample fixture:
npm run agent -- --once --all   # --all bypasses the 6h kickoff window for testing
npm run agent -- --resolve      # resolve finished matches (updates on-chain accuracy)

# 4. Run the autonomous loop (predict every 10 min, resolve every 15 min):
npm run agent

# 5. Open the public scoreboard + Verify button:
cd frontend && python3 -m http.server 8099   # then open http://localhost:8099
```

**Live fixtures:** set `FOOTBALL_API_KEY` (free at football-data.org) to predict real
upcoming matches. With no key, the agent reads `data/fixtures.json` and resolution reads
`data/results.json` — enough to demo the whole loop offline.

**Social (the distribution engine):** when a prediction commits, the agent posts a
pre-kickoff call to X ("🔮 The Oracle has spoken… verify it yourself"); when it resolves,
it posts the un-fakeable receipt ("✅ Called it" / "❌ Missed this one") with the live
accuracy. Set the four `X_*` OAuth 1.0a credentials to post for real; leave them blank and
the agent **dry-runs** (prints the exact tweet instead of posting), so the loop never
breaks. Signing is built in with no extra dependency (`src/social/x.ts`) and validated
against X's canonical signature example.

**The Verify button** fetches the record straight from the 0G Storage gateway,
recomputes `keccak256(canonicalJSON(record))` in the browser, and asserts it equals the
on-chain commit — plus `committedAt < kickoff` and the TEE flag. Nothing trusts our
server. Update `frontend/config.js` with your contract address after deploying.

## Network

| | Testnet (Galileo) | Mainnet |
|---|---|---|
| RPC | `https://evmrpc-testnet.0g.ai` | `https://evmrpc.0g.ai` |
| Build on testnet until stable; mainnet for the final lock. | | |

## Honest caveats (we'd rather name these than have a judge find them)

- **Result resolution trusts an off-chain data feed.** The source is recorded in every
  record (`dataSources`). Full trustlessness would need a decentralized score oracle —
  out of scope for the window, named as future work.
- **TEE verification proves integrity, not correctness.** It proves the model genuinely
  produced the prediction untampered; it does not prove the call is *good*. The public
  scoreboard is what earns that, over time. We don't blur the two.
- **Keys stay server-side.** The agent's private key funds compute and signs commits —
  env vars only, never the frontend.

## Roadmap (mapped to the bracket)

- **Group stage (Jun 23):** vertical slice — predict → TEE verify → store → commit →
  public page with a working Verify button. ✅ this repo.
- **R32 → R16:** running scoreboard, resolution pipeline, auto social posts, Agentic ID,
  polished verify UX.
- **Final lock (Jul 8):** full autonomous loop + weeks of real verified track record
  already on chain — the one thing nobody can fake at the buzzer.
