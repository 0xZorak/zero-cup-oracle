// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/OracleRegistry.sol";

contract OracleRegistryTest is Test {
    OracleRegistry reg;
    address agent = address(0xA9E37);
    address stranger = address(0xBEEF);

    function setUp() public {
        vm.warp(1_000_000);
        reg = new OracleRegistry(agent);
    }

    function _commit(uint256 matchId, uint64 kickoff, OracleRegistry.Outcome o) internal returns (uint256) {
        vm.prank(agent);
        return reg.commitPrediction(
            matchId,
            keccak256(abi.encode(matchId)),
            keccak256(abi.encode("root", matchId)),
            kickoff,
            o
        );
    }

    function test_CommitsBeforeKickoff() public {
        uint256 id = _commit(57, uint64(block.timestamp + 3600), OracleRegistry.Outcome.HOME);
        OracleRegistry.Prediction memory p = reg.getPrediction(id);
        assertEq(p.matchId, 57);
        assertEq(uint8(p.status), uint8(OracleRegistry.Status.Pending));
        assertEq(p.committedAt, uint64(block.timestamp));
    }

    function test_RevertsAfterKickoff() public {
        vm.prank(agent);
        vm.expectRevert(OracleRegistry.AfterKickoff.selector);
        reg.commitPrediction(57, bytes32(0), bytes32(0), uint64(block.timestamp), OracleRegistry.Outcome.HOME);
    }

    function test_OnlyAgentCanCommit() public {
        vm.prank(stranger);
        vm.expectRevert(OracleRegistry.NotAgent.selector);
        reg.commitPrediction(57, bytes32(0), bytes32(0), uint64(block.timestamp + 1), OracleRegistry.Outcome.HOME);
    }

    function test_NoDoubleCommit() public {
        _commit(57, uint64(block.timestamp + 3600), OracleRegistry.Outcome.HOME);
        vm.prank(agent);
        vm.expectRevert(OracleRegistry.AlreadyCommitted.selector);
        reg.commitPrediction(57, bytes32(0), bytes32(0), uint64(block.timestamp + 3600), OracleRegistry.Outcome.AWAY);
    }

    function test_ResolveUpdatesAccuracy() public {
        uint256 a = _commit(1, uint64(block.timestamp + 10), OracleRegistry.Outcome.HOME);
        uint256 b = _commit(2, uint64(block.timestamp + 10), OracleRegistry.Outcome.AWAY);

        vm.startPrank(agent);
        reg.resolvePrediction(a, OracleRegistry.Outcome.HOME); // correct
        reg.resolvePrediction(b, OracleRegistry.Outcome.DRAW); // wrong
        vm.stopPrank();

        assertEq(reg.correctCount(), 1);
        assertEq(reg.resolvedCount(), 2);
        assertEq(reg.accuracyBps(), 5000); // 50.00%
    }

    function test_CannotDoubleResolve() public {
        uint256 a = _commit(1, uint64(block.timestamp + 10), OracleRegistry.Outcome.HOME);
        vm.startPrank(agent);
        reg.resolvePrediction(a, OracleRegistry.Outcome.HOME);
        vm.expectRevert(OracleRegistry.AlreadyResolved.selector);
        reg.resolvePrediction(a, OracleRegistry.Outcome.AWAY);
        vm.stopPrank();
    }
}
