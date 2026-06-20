import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("0x...") || v === "") {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  privateKey: required("PRIVATE_KEY"),
  rpcUrl: optional("OG_RPC_URL", "https://evmrpc-testnet.0g.ai"),
  chainId: Number(optional("OG_CHAIN_ID", "16602")),
  oracleContract: optional("ORACLE_CONTRACT_ADDRESS"),
  inftContract: optional("INFT_CONTRACT_ADDRESS"),
  computeProvider: optional("COMPUTE_PROVIDER_ADDRESS"),
  ledgerMinBalance: Number(optional("LEDGER_MIN_BALANCE", "1")),
  ledgerTopupAmount: Number(optional("LEDGER_TOPUP_AMOUNT", "1")),
  ledgerInitAmount: Number(optional("LEDGER_INIT_AMOUNT", "3")),
  storageIndexerUrl: optional(
    "OG_STORAGE_INDEXER_URL",
    "https://indexer-storage-testnet-turbo.0g.ai",
  ),
  footballApiBase: optional("FOOTBALL_API_BASE", "https://api.football-data.org/v4"),
  footballApiKey: optional("FOOTBALL_API_KEY"),
  // X / social (OAuth 1.0a user context). All four blank ⇒ dry-run (prints, no post).
  xApiKey: optional("X_API_KEY"),
  xApiSecret: optional("X_API_SECRET"),
  xAccessToken: optional("X_ACCESS_TOKEN"),
  xAccessSecret: optional("X_ACCESS_SECRET"),
  // Public scoreboard URL used in the "verify it yourself" links.
  frontendUrl: optional("FRONTEND_URL", "http://localhost:8099"),
} as const;
