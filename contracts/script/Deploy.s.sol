// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/OracleRegistry.sol";

/// Deploy to 0G Galileo testnet:
///   forge script script/Deploy.s.sol --rpc-url og_testnet --broadcast \
///     --private-key $PRIVATE_KEY
/// The agent address defaults to the deployer (the agent funds compute AND
/// signs commits with the same wallet).
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.addr(pk);
        vm.startBroadcast(pk);
        OracleRegistry reg = new OracleRegistry(agent);
        vm.stopBroadcast();
        console.log("OracleRegistry deployed at:", address(reg));
        console.log("agent (sole writer):       ", agent);
    }
}
