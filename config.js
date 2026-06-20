// Public config — read-only. Safe to ship to the browser (no keys here).
// Update `contract` whenever you redeploy OracleRegistry.
window.ORACLE_CONFIG = {
  rpc: "https://evmrpc-testnet.0g.ai",
  chainId: 16602,
  contract: "0xBdA8083aCCf45Fe5b838936C94D53a91042D9Bbb",
  // Prediction iNFT — soulbound ERC-721, one token minted per prediction.
  inft: "0x92DCcfA420397bAF3e60A3a673c6c1cC9677e9cC",
  // 0G Storage gateway — fetches a record by its rootHash (CORS-open).
  storageGateway: "https://indexer-storage-testnet-turbo.0g.ai/file?root=",
  // Block / storage explorers (for "open in explorer" links — never the bare gateway).
  explorerTx: "https://chainscan-galileo.0g.ai/tx/",
  explorerAddr: "https://chainscan-galileo.0g.ai/address/",
  storageExplorer: "https://storagescan-galileo.0g.ai/",
};
