// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OracleRegistry
/// @notice A thin public registry + scoreboard for the Verifiable World Cup Oracle.
///         It stores ONLY the hash of each prediction record (the full record
///         lives in 0G Storage) and enforces the one guarantee that makes the
///         whole thing un-fakeable: a prediction's commit must mine BEFORE
///         kickoff. Accuracy is computed from on-chain truth, never a database.
contract OracleRegistry {
    enum Outcome { HOME, DRAW, AWAY }
    enum Status  { Pending, Correct, Wrong }

    struct Prediction {
        uint256 matchId;
        bytes32 recordHash;  // keccak256(canonicalJSON(record)) — content commitment
        bytes32 storageRoot; // 0G Storage rootHash — where the full record lives
        uint64  kickoff;     // unix ts
        uint64  committedAt; // block timestamp of the commit (proof it beat kickoff)
        Outcome predicted;
        Outcome actual;
        Status  status;
    }

    address public immutable agent; // the agent wallet / Agentic ID — sole writer

    Prediction[] private _predictions;
    mapping(uint256 => bool) public committedMatch; // idempotency: one per matchId
    uint256 public correctCount;
    uint256 public resolvedCount;

    event PredictionCommitted(
        uint256 indexed id,
        uint256 indexed matchId,
        bytes32 recordHash,
        bytes32 storageRoot,
        uint64 kickoff,
        Outcome predicted
    );
    event PredictionResolved(uint256 indexed id, Outcome actual, Status status);

    error NotAgent();
    error AfterKickoff();
    error AlreadyCommitted();
    error BadId();
    error AlreadyResolved();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address agent_) {
        agent = agent_;
    }

    /// @notice Commit a prediction. MUST be called before kickoff — that
    ///         timestamp inequality is the integrity guarantee.
    function commitPrediction(
        uint256 matchId,
        bytes32 recordHash,
        bytes32 storageRoot,
        uint64 kickoff,
        Outcome predicted
    ) external onlyAgent returns (uint256 id) {
        if (block.timestamp >= kickoff) revert AfterKickoff();
        if (committedMatch[matchId]) revert AlreadyCommitted();

        committedMatch[matchId] = true;
        id = _predictions.length;
        _predictions.push(
            Prediction({
                matchId: matchId,
                recordHash: recordHash,
                storageRoot: storageRoot,
                kickoff: kickoff,
                committedAt: uint64(block.timestamp),
                predicted: predicted,
                actual: Outcome.HOME,
                status: Status.Pending
            })
        );
        emit PredictionCommitted(id, matchId, recordHash, storageRoot, kickoff, predicted);
    }

    /// @notice Resolve a prediction against the real result. Updates the running
    ///         accuracy. Trusts an off-chain data feed (see README caveats).
    function resolvePrediction(uint256 id, Outcome actual) external onlyAgent {
        if (id >= _predictions.length) revert BadId();
        Prediction storage p = _predictions[id];
        if (p.status != Status.Pending) revert AlreadyResolved();

        p.actual = actual;
        p.status = (p.predicted == actual) ? Status.Correct : Status.Wrong;
        if (p.status == Status.Correct) correctCount++;
        resolvedCount++;

        emit PredictionResolved(id, actual, p.status);
    }

    // ── views: the frontend computes everything from these, never our server ──

    function getPrediction(uint256 id) external view returns (Prediction memory) {
        if (id >= _predictions.length) revert BadId();
        return _predictions[id];
    }

    function totalPredictions() external view returns (uint256) {
        return _predictions.length;
    }

    /// @notice Accuracy in basis points (0..10000) over resolved predictions.
    function accuracyBps() external view returns (uint256) {
        if (resolvedCount == 0) return 0;
        return (correctCount * 10000) / resolvedCount;
    }
}
