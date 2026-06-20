# Running The Oracle continuously

The agent's value compounds: the longer it runs, the deeper the un-fakeable
on-chain track record. This is how to take it from manual one-shots to an
always-on agent against live fixtures.

## 1. Get a (free) football data key — 2 minutes

Without a key the agent falls back to `data/fixtures.json` / `data/results.json`
(fine for a demo). For **real** upcoming matches and automatic resolution:

1. Register free at <https://www.football-data.org/client/register>.
2. Copy your API token.
3. Put it in `.env`:
   ```
   FOOTBALL_API_KEY=your_token_here
   ```

The adapter ([`src/data/football.ts`](src/data/football.ts)) handles the rest:
it pulls upcoming fixtures and finished results from football-data.org v4, and
silently falls back to the local JSON if the key is missing.

## 2. Run it — one command

```bash
npm run agent
```

That starts the autonomous loop: **predict every 10 min, resolve every 15 min**
([`src/agent/loop.ts`](src/agent/loop.ts)). It's idempotent — it never
double-commits or double-resolves, so it's safe to restart anytime.

Useful one-shots:
```bash
npm run agent -- --once         # one predict tick, then exit
npm run agent -- --once --all   # ignore the 6h kickoff window (testing)
npm run agent -- --resolve      # resolve finished matches only
```

## 3. Keep it always-on (pick one)

The loop must run on a machine that stays up. Cheapest reliable options:

**A. A small VPS + pm2** (most control)
```bash
npm i -g pm2
pm2 start "npm run agent" --name oracle
pm2 save && pm2 startup     # restart on reboot
```

**B. Docker** (portable — runs anywhere)
```bash
docker build -t the-oracle .
docker run -d --restart unless-stopped --env-file .env --name oracle the-oracle
```

**C. Railway / Render / Fly.io** (no server to manage)
- Point it at this repo. The included [`Procfile`](Procfile) declares a
  `worker: npm run agent` process — deploy it as a **worker/background** service
  (not a web service; there's no HTTP port).
- Add your env vars (`PRIVATE_KEY`, `ORACLE_CONTRACT_ADDRESS`,
  `INFT_CONTRACT_ADDRESS`, `COMPUTE_PROVIDER_ADDRESS`, `FOOTBALL_API_KEY`, and the
  optional `X_*`) in the dashboard.

## 4. Keep the wallet funded

Each prediction spends a little OG (compute ledger + commit + iNFT mint gas) and
the ledger requires a 3-OG minimum. Top up the agent wallet
(`0xaa61388fbDd6e557a8Fb2E02393B311AcEA27B6f`) from the 0G Galileo faucet so the
loop never stalls.

## 5. (Optional) go live on X

Set the four `X_*` OAuth 1.0a creds in `.env` to post the pre-kickoff call and
the post-match receipt for real. Leave them blank and the agent **dry-runs**
(prints the tweet, never breaks the loop). Preview with `npm run probe:x`.

---

> Security: the agent's `PRIVATE_KEY` stays in env vars on the host, never in the
> frontend. This testnet key was exposed during development — **rotate to a fresh
> wallet before any mainnet run.**
