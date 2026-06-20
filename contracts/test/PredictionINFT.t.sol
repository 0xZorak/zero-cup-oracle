// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionINFT.sol";

contract PredictionINFTTest is Test {
    PredictionINFT inft;
    address agent = address(0xA9E37);
    address stranger = address(0xBEEF);

    bytes32 root = keccak256("storage-root");
    bytes32 rec = keccak256("record-hash");
    string uri = "https://indexer-storage-testnet-turbo.0g.ai/file?root=0xabc";

    function setUp() public {
        vm.warp(1_000_000);
        inft = new PredictionINFT(agent, "did:0g:0xA9E37");
    }

    function _mint(uint256 predictionId) internal returns (uint256) {
        vm.prank(agent);
        return inft.mint(predictionId, root, rec, uri);
    }

    function test_AgentMintsAndBindsMetadata() public {
        uint256 id = _mint(7);
        assertEq(id, 0);
        assertEq(inft.ownerOf(0), agent);
        assertEq(inft.balanceOf(agent), 1);
        assertEq(inft.totalSupply(), 1);
        assertEq(inft.tokenURI(0), uri);

        (uint256 pid, bytes32 sroot, bytes32 rhash, uint64 mintedAt) = inft.meta(0);
        assertEq(pid, 7);
        assertEq(sroot, root);
        assertEq(rhash, rec);
        assertEq(mintedAt, uint64(block.timestamp));

        // predictionId -> tokenId mapping (stored as tokenId+1)
        assertEq(inft.tokenOfPrediction(7), 1);
        assertTrue(inft.mintedForPrediction(7));
    }

    function test_TokenIdsIncrement() public {
        assertEq(_mint(1), 0);
        assertEq(_mint(2), 1);
        assertEq(_mint(3), 2);
        assertEq(inft.totalSupply(), 3);
        assertEq(inft.balanceOf(agent), 3);
    }

    function test_OnlyAgentCanMint() public {
        vm.prank(stranger);
        vm.expectRevert(PredictionINFT.NotAgent.selector);
        inft.mint(1, root, rec, uri);
    }

    function test_OnePerPrediction() public {
        _mint(7);
        vm.prank(agent);
        vm.expectRevert(PredictionINFT.AlreadyMinted.selector);
        inft.mint(7, root, rec, uri);
    }

    function test_Soulbound_TransfersRevert() public {
        _mint(7);
        vm.startPrank(agent);
        vm.expectRevert(PredictionINFT.Soulbound.selector);
        inft.transferFrom(agent, stranger, 0);
        vm.expectRevert(PredictionINFT.Soulbound.selector);
        inft.approve(stranger, 0);
        vm.expectRevert(PredictionINFT.Soulbound.selector);
        inft.setApprovalForAll(stranger, true);
        vm.stopPrank();
    }

    function test_SupportsERC721Interfaces() public view {
        assertTrue(inft.supportsInterface(0x01ffc9a7)); // ERC165
        assertTrue(inft.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(inft.supportsInterface(0x5b5e139f)); // ERC721 Metadata
        assertFalse(inft.supportsInterface(0xffffffff));
    }

    function test_BadTokenReverts() public {
        vm.expectRevert(PredictionINFT.BadToken.selector);
        inft.ownerOf(99);
        vm.expectRevert(PredictionINFT.BadToken.selector);
        inft.tokenURI(99);
    }
}
