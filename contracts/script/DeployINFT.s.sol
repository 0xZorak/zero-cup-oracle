// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PredictionINFT.sol";

/// Deploy the Prediction iNFT to 0G Galileo testnet:
///   forge script script/DeployINFT.s.sol --rpc-url og_testnet --broadcast \
///     --private-key $PRIVATE_KEY --legacy --gas-price 4000000007
/// The agent (sole minter) defaults to the deployer — same wallet that runs the
/// agent and owns the Agentic ID.
contract DeployINFT is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.addr(pk);
        string memory did = string.concat("did:0g:", vm.toString(agent));
        vm.startBroadcast(pk);
        PredictionINFT inft = new PredictionINFT(agent, did);
        vm.stopBroadcast();
        console.log("PredictionINFT deployed at:", address(inft));
        console.log("agent (sole minter):       ", agent);
        console.log("agentDid:                  ", did);
    }
}
