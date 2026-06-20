// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PredictionINFT
/// @notice A soulbound ERC-721 ("intelligent NFT") that mints one token per
///         Oracle prediction, binding it to the agent's 0G Agentic ID and the
///         immutable 0G Storage record. The token is the on-chain, wallet- and
///         explorer-visible artifact of a verifiable call:
///           • `tokenURI` resolves to the full record on the 0G Storage gateway,
///           • `storageRoot` + `recordHash` pin the exact bytes that were hashed
///             on-chain in OracleRegistry,
///           • `predictionId` links back to the registry entry.
///         Tokens are soulbound (non-transferable): a prediction's provenance
///         belongs to the agent that produced it and cannot be traded away.
/// @dev Minimal, dependency-free ERC-721 (metadata) implementation. Only the
///      agent may mint. Transfers/approvals revert — this is identity, not a
///      collectible.
contract PredictionINFT {
    // ── ERC-721 metadata ──
    string public constant name = "The Oracle Prediction";
    string public constant symbol = "ORACLE";

    address public immutable agent; // sole minter — the Agentic ID wallet
    string  public agentDid;        // did:0g:<agent> — the bound Agentic ID

    struct Meta {
        uint256 predictionId; // OracleRegistry id this token attests
        bytes32 storageRoot;  // 0G Storage root of the full record
        bytes32 recordHash;   // keccak256(canonicalJSON(record)) — same as registry
        uint64  mintedAt;     // block timestamp
    }

    uint256 private _next;                       // next token id (also total minted)
    mapping(uint256 => address) private _owner;  // tokenId => owner
    mapping(uint256 => string)  private _uri;    // tokenId => tokenURI
    mapping(uint256 => Meta)    public  meta;    // tokenId => attestation data
    mapping(address => uint256) private _bal;    // owner => balance
    mapping(uint256 => uint256) public  tokenOfPrediction;     // predictionId => tokenId+1 (0 = none)
    mapping(uint256 => bool)    public  mintedForPrediction;   // predictionId => minted?

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event PredictionMinted(
        uint256 indexed tokenId,
        uint256 indexed predictionId,
        bytes32 storageRoot,
        bytes32 recordHash
    );

    error NotAgent();
    error Soulbound();
    error AlreadyMinted();
    error BadToken();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address agent_, string memory agentDid_) {
        agent = agent_;
        agentDid = agentDid_;
    }

    /// @notice Mint the iNFT for a prediction. One per predictionId.
    /// @param predictionId  OracleRegistry id this token attests.
    /// @param storageRoot   0G Storage root of the full record.
    /// @param recordHash    keccak256(canonicalJSON(record)).
    /// @param uri           tokenURI — the 0G Storage gateway URL for the record.
    function mint(
        uint256 predictionId,
        bytes32 storageRoot,
        bytes32 recordHash,
        string calldata uri
    ) external onlyAgent returns (uint256 tokenId) {
        if (mintedForPrediction[predictionId]) revert AlreadyMinted();

        tokenId = _next++;
        _owner[tokenId] = agent;
        _bal[agent] += 1;
        _uri[tokenId] = uri;
        meta[tokenId] = Meta({
            predictionId: predictionId,
            storageRoot: storageRoot,
            recordHash: recordHash,
            mintedAt: uint64(block.timestamp)
        });
        mintedForPrediction[predictionId] = true;
        tokenOfPrediction[predictionId] = tokenId + 1; // +1 so 0 means "none"

        emit Transfer(address(0), agent, tokenId);
        emit PredictionMinted(tokenId, predictionId, storageRoot, recordHash);
    }

    // ── views ──

    function totalSupply() external view returns (uint256) {
        return _next;
    }

    function ownerOf(uint256 tokenId) public view returns (address o) {
        o = _owner[tokenId];
        if (o == address(0)) revert BadToken();
    }

    function balanceOf(address o) external view returns (uint256) {
        return _bal[o];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owner[tokenId] == address(0)) revert BadToken();
        return _uri[tokenId];
    }

    /// @notice ERC-165 — advertises ERC-721 + metadata so wallets/explorers index it.
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == 0x01ffc9a7 || // ERC-165
            id == 0x80ac58cd || // ERC-721
            id == 0x5b5e139f;   // ERC-721 Metadata
    }

    // ── soulbound: transfers & approvals are disabled ──

    function approve(address, uint256) external pure { revert Soulbound(); }
    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }
    function getApproved(uint256) external pure returns (address) { return address(0); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }
    function transferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Soulbound(); }
}
