/**
 * Camera-friendly MCP demo — run this on screen to show, live, that ANOTHER
 * agent can read AND independently verify the Oracle's on-chain record through
 * the MCP server. Clean, paced output for screen-recording.
 *
 *   node scripts/mcp-demo.mjs            # verifies the latest prediction
 *   node scripts/mcp-demo.mjs 0          # verify a specific id
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s = "") => console.log(s);

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "mcp/server.ts"],
  cwd: process.cwd(),
});
const client = new Client({ name: "the-oracle-demo", version: "1.0.0" });

line("\n🔌 Connecting another agent to The Oracle over MCP…");
await client.connect(transport);
await wait(700);

const tools = (await client.listTools()).tools.map((t) => t.name);
line(`✅ Connected. Tools available: ${tools.join(", ")}`);
await wait(1200);

line("\n📊 Asking the Oracle for its on-chain scoreboard…");
const sb = JSON.parse((await client.callTool({ name: "oracle_get_scoreboard", arguments: {} })).content[0].text);
await wait(600);
line(`   ${sb.totalPredictions} predictions · ${sb.correct}/${sb.resolved} resolved · ${sb.accuracyPercent}% accuracy`);
line(`   (every figure derived from 0G Chain — contract ${sb.contract})`);
await wait(1500);

// pick the prediction to verify: arg, else the latest
const arg = process.argv[2];
const id = arg !== undefined ? Number(arg) : sb.totalPredictions - 1;

line(`\n🔍 Independently verifying prediction #${id} — no trust in their server…`);
await wait(900);
const v = JSON.parse((await client.callTool({ name: "oracle_verify_prediction", arguments: { id } })).content[0].text);

if (v.error) {
  line(`   ⚠️  ${v.error}`);
} else {
  const c = v.checks;
  line(`   match: ${v.match}`);
  await wait(700);
  line(`   • on-chain hash : ${c.integrity_hashMatchesChain.onChainHash}`);
  line(`   • recomputed    : ${c.integrity_hashMatchesChain.recomputedHash}`);
  line(`     → match: ${c.integrity_hashMatchesChain.pass ? "✅" : "❌"}`);
  await wait(1200);
  line(`   • committed before kickoff: ${c.preKickoff_committedBeforeKickoff.pass ? "✅" : "❌"} ` +
    `(${c.preKickoff_committedBeforeKickoff.committedAt} < ${c.preKickoff_committedBeforeKickoff.kickoff})`);
  await wait(900);
  line(`   • produced inside a TEE   : ${c.authenticity_teeSignaturesValid.pass ? "✅" : "❌"}`);
  await wait(1000);
  line(`\n   ${v.verified ? "✅ VERIFIED ON-CHAIN — the Oracle really called this before kickoff." : "❌ verification failed"}`);
}

await wait(800);
line("");
await client.close();
process.exit(0);
