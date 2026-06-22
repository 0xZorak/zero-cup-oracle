# The Oracle — Verifiable World Cup Predictions on 0G

> Paste-ready submission copy for the 0G Zero Cup. Trim to the platform's field
> limits as needed.

## One-liner

An autonomous AI that predicts every World Cup match **before kickoff** and makes each
call **impossible to fake or backdate** — proven on 0G, verifiable in your browser.

## Links

- **Live demo:** https://the-oracle-0g.vercel.app (open it, click **Verify** on any prediction)
- **Repo:** https://github.com/0xZorak/zero-cup-oracle
- **Demo video:** <paste your Demosmith link here>
- **Mirror:** https://0xzorak.github.io/zero-cup-oracle/

## The problem

Anyone can claim they predicted a result — *after* the match. Screenshots get faked,
timestamps get edited, tipsters quietly delete their misses. There's no way to trust an AI
prediction record because nothing proves the call (a) was really produced by the model,
(b) wasn't tampered with, and (c) existed *before* the outcome was known.

## What it does

For each upcoming match, the agent:

1. **Reasons** through a panel of AI agents — The Statistician, The Tactician, The
   Contrarian — each running inside a **TEE on 0G Compute**, then a judge agent commits one
   verdict.
2. **Stores** the full record (call, debate, rationale) on **0G Storage**.
3. **Commits** `keccak256(canonicalJSON(record))` on **0G Chain** — and the contract
   *reverts the commit unless it lands before kickoff*.
4. **Mints** a soulbound **iNFT** for the prediction, bound to the agent's 0G Agentic ID.
5. After the match, **resolves** the result on-chain and updates a public accuracy scoreboard.

The site re-derives the entire proof client-side. It also ships a **"Beat the Oracle"**
game, an **"Ask the Oracle"** chat, and an **MCP server** so *other* AI agents can read and
independently verify the record.

## Why 0G is load-bearing (not a bolt-on)

Remove 0G and the product ceases to exist:

- **0G Compute** produces every prediction inside a TEE; the broker verifies the signature
  (`processResponse`), proving the model genuinely produced it, untampered.
- **0G Storage** holds the full record, content-addressed — what the browser fetches back to
  re-hash.
- **0G Chain** enforces the one guarantee that makes it un-fakeable: the commit must mine
  **before kickoff**, and accuracy is computed from on-chain truth, never a database. It also
  carries the soulbound Prediction iNFTs.

## How to verify it yourself (for judges)

1. Open the live demo and click **Verify** on any prediction.
2. Your browser fetches the record from the 0G Storage gateway, recomputes
   `keccak256(canonicalJSON(record))`, and checks it against the on-chain commit — plus
   `committedAt < kickoff` and the TEE signature. Nothing trusts our server.
3. Or do it from another agent: `npm run mcp`, then call `oracle_verify_prediction` — same
   check, machine-to-machine.

## How to run the agent

```bash
npm install
cp .env.example .env     # set PRIVATE_KEY (funded 0G testnet wallet) + FOOTBALL_API_KEY
npm run probe:tee        # de-risk the TEE path — want teeSignatureValid: true
npm run agent            # autonomous loop: predict before kickoff, resolve after
```

Continuous hosting (free options incl. the included GitHub Actions cron) is documented in
[RUNNING.md](RUNNING.md). Contracts: [contracts/](contracts/) (`forge test` — all passing).

## Built during the tournament window

Original work by the team, built June 2026 for the 0G Zero Cup. Open-source libraries only;
not a fork or a pre-existing product.

## Tech

TypeScript · ethers v6 · 0G Serving Broker (Compute) · 0G TS SDK (Storage) · Solidity/Foundry
(Chain) · Model Context Protocol SDK · vanilla JS frontend (no build step).

## Deployed (0G Galileo testnet · chain id 16602)

| Contract | Address |
|---|---|
| OracleRegistry | `0xBdA8083aCCf45Fe5b838936C94D53a91042D9Bbb` |
| PredictionINFT (soulbound) | `0x92DCcfA420397bAF3e60A3a673c6c1cC9677e9cC` |
| Agent / Agentic ID | `0xaa61388fbDd6e557a8Fb2E02393B311AcEA27B6f` |

## Honest status

Live on **testnet**; predictions are committed and independently verifiable on-chain today.
The track record is early and grows every time the agent runs. Result resolution trusts an
off-chain football feed (recorded in every record); X auto-posting is built but off unless
credentials are set. See [HACKING.md](HACKING.md) for an honest "building on 0G" field report.
