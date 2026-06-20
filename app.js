/* The Oracle — verifiable scoreboard. Read-only; no wallet needed for visitors.
   Verify re-derives integrity client-side with zero trust in our server: it
   fetches the record from 0G Storage, recomputes the hash, and compares it to
   the on-chain commit, right here in the browser. */

const CFG = window.ORACLE_CONFIG;
const OUTCOME = ["HOME", "DRAW", "AWAY"];
const STATUS = ["Pending", "Correct", "Wrong"];

const ABI = [
  "function getPrediction(uint256 id) view returns (tuple(uint256 matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint64 committedAt, uint8 predicted, uint8 actual, uint8 status))",
  "function totalPredictions() view returns (uint256)",
  "function correctCount() view returns (uint256)",
  "function resolvedCount() view returns (uint256)",
  "function accuracyBps() view returns (uint256)",
];

const INFT_ABI = ["function tokenOfPrediction(uint256) view returns (uint256)"];

const provider = new ethers.JsonRpcProvider(CFG.rpc, CFG.chainId);
const oracle = new ethers.Contract(CFG.contract, ABI, provider);
// Soulbound Prediction iNFT (optional — only if configured).
const inft = CFG.inft ? new ethers.Contract(CFG.inft, INFT_ABI, provider) : null;

// ── canonical JSON — MUST byte-match the agent's src/canonical.ts ──────────────
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]);
    return o;
  }
  return v;
}
const canonicalJSON = (v) => JSON.stringify(sortDeep(v));

const fmtTs = (s) => new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const short = (h) => h.slice(0, 10) + "…" + h.slice(-6);
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Landing page caps each tab at 5 and links to predictions.html for the rest.
// predictions.html sets window.ORACLE_FULL = true to show everything.
const FULL_PAGE = !!window.ORACLE_FULL;
const PAGE_LIMIT = 5;
const $ = (id) => document.getElementById(id);
const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };

// Shared state (also read by the chat agent).
const State = {
  predictions: [],
  total: -1,
  tab: location.hash === "#verified" ? "verified" : "upcoming",
};
window.OracleData = State;

// ── data loading (reentrancy-guarded + render-on-change ⇒ no duplication) ───────
let loading = false;

async function loadScoreboard() {
  const [total, correct, resolved, bps] = await Promise.all([
    oracle.totalPredictions(),
    oracle.correctCount(),
    oracle.resolvedCount(),
    oracle.accuracyBps(),
  ]);
  const acc = Number(bps) / 100;
  setText("stat-total", total.toString());
  setText("stat-resolved", `${correct} / ${resolved}`);
  setText("stat-accuracy", Number(resolved) === 0 ? "—" : acc.toFixed(0) + "%");
  const ring = $("acc-ring");
  if (ring) ring.style.setProperty("--p", `${Number(resolved) === 0 ? 0 : acc}`);
  return Number(total);
}

async function fetchPrediction(id) {
  const p = await oracle.getPrediction(id);
  const base = {
    id,
    recordHash: p.recordHash,
    storageRoot: p.storageRoot,
    kickoff: Number(p.kickoff),
    committedAt: Number(p.committedAt),
    predicted: OUTCOME[Number(p.predicted)],
    actual: OUTCOME[Number(p.actual)],
    status: STATUS[Number(p.status)],
    record: null,
    inftTokenId: null,
  };
  const tasks = [];
  if (p.storageRoot && p.storageRoot !== ZERO) {
    tasks.push(
      fetch(CFG.storageGateway + p.storageRoot)
        .then((r) => r.json())
        .then((j) => { base.record = j; })
        .catch(() => { /* gateway hiccup — keep on-chain data only */ }),
    );
  }
  if (inft) {
    tasks.push(
      inft
        .tokenOfPrediction(id)
        .then((t) => { const n = Number(t); if (n > 0) base.inftTokenId = n - 1; })
        .catch(() => { /* iNFT not minted / contract unavailable */ }),
    );
  }
  await Promise.all(tasks);
  return base;
}

async function main() {
  if (loading) return; // guard against overlapping refreshes (the duplication bug)
  loading = true;
  try {
    const total = await loadScoreboard();
    if (total !== State.total) {
      // Fetch all predictions (+ records) in parallel, render once, atomically.
      State.predictions = await Promise.all(
        Array.from({ length: total }, (_, id) => fetchPrediction(id)),
      );
      State.predictions.sort((a, b) => b.id - a.id);
      State.total = total;
      renderList();
    }
  } catch (e) {
    document.getElementById("list").innerHTML =
      `<p class="empty">Failed to reach 0G Chain: ${e.message}</p>`;
  } finally {
    loading = false;
  }
}

// ── tabs: "upcoming" (Pending) vs "verified" (resolved) ──────────────────────────
const inTab = (p, tab) => (tab === "verified" ? p.status !== "Pending" : p.status === "Pending");

function setTab(tab) {
  State.tab = tab;
  if (!FULL_PAGE && location.hash) history.replaceState(null, "", location.pathname);
  renderList();
}
function wireTabs() {
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab)),
  );
}

// ── rendering ───────────────────────────────────────────────────────────────────
function renderList() {
  const list = $("list");
  if (!list) return;

  // tab chips: active state + live counts
  const counts = {
    upcoming: State.predictions.filter((p) => inTab(p, "upcoming")).length,
    verified: State.predictions.filter((p) => inTab(p, "verified")).length,
  };
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === State.tab);
    const label = b.dataset.tab === "verified" ? "Verified" : "Upcoming";
    b.textContent = `${label} (${counts[b.dataset.tab]})`;
  });

  const set = State.predictions.filter((p) => inTab(p, State.tab));
  const shown = FULL_PAGE ? set : set.slice(0, PAGE_LIMIT);

  if (set.length === 0) {
    list.innerHTML = `<p class="empty">${
      State.tab === "verified"
        ? "No resolved predictions yet — check back after kickoff."
        : "No upcoming predictions right now. The Oracle is between matches."
    }</p>`;
  } else {
    list.innerHTML = shown.map(rowHTML).join("");
    shown.forEach((p) => $(`btn-${p.id}`)?.addEventListener("click", () => verify(p.id)));
  }

  // "Show more" → the dedicated full page (landing only)
  const more = $("showmore");
  if (more) {
    const extra = set.length - shown.length;
    more.innerHTML =
      !FULL_PAGE && extra > 0
        ? `<a class="showmore-btn" href="predictions.html#${State.tab}">Show all ${set.length} ${State.tab} →</a>`
        : "";
  }
  renderCalibration();
}

// Calibration: when the Oracle says X%, does it actually win ~X%? A credibility
// signal computed entirely from on-chain truth + the stored confidences.
function renderCalibration() {
  const el = document.getElementById("calib");
  if (!el) return;
  const resolved = State.predictions.filter((p) => p.status !== "Pending" && p.record?.prediction);
  if (resolved.length < 1) {
    el.innerHTML = "";
    return;
  }
  const avgConf = resolved.reduce((s, p) => s + p.record.prediction.confidence, 0) / resolved.length;
  const hitRate = resolved.filter((p) => p.status === "Correct").length / resolved.length;
  const gap = Math.abs(avgConf - hitRate) * 100;
  const verdict = gap <= 12 ? "well-calibrated" : avgConf > hitRate ? "a touch overconfident" : "modest — wins more than it claims";
  el.innerHTML =
    `<b>Calibration:</b> claims <b>${Math.round(avgConf * 100)}%</b> on average, ` +
    `right <b>${Math.round(hitRate * 100)}%</b> of the time over ${resolved.length} resolved ` +
    `<span class="muted">— ${verdict}</span>`;
}

function rowHTML(p) {
  const teams = p.record
    ? `<strong>${p.record.match.home}</strong> <span class="vs">vs</span> <strong>${p.record.match.away}</strong>`
    : `Prediction #${p.id}`;
  const panel = p.record?.debate?.panel?.length
    ? `<span class="pill panel">⚖ ${p.record.debate.panel.length}-agent debate</span>`
    : "";
  const inftPill =
    p.inftTokenId != null
      ? `<a class="pill inft" href="${CFG.explorerAddr}${CFG.inft}" target="_blank" rel="noopener" title="Soulbound iNFT bound to the agent's 0G Agentic ID">🪙 iNFT #${p.inftTokenId}</a>`
      : "";
  return `
    <div class="row">
      <div class="row-id">#${p.id}</div>
      <div class="row-main">
        <div class="teams">${teams}</div>
        <div class="meta">
          <span class="pill pred">CALL · ${p.predicted}</span>
          <span class="pill status-${p.status.toLowerCase()}">${p.status}</span>
          ${panel}
          ${inftPill}
          <span class="muted">kickoff ${fmtTs(p.kickoff)}</span>
        </div>
      </div>
      <button class="verify-btn" id="btn-${p.id}">Verify ✦</button>
    </div>`;
}

// ── verification (opens a blurred modal card) ────────────────────────────────────
async function verify(id) {
  const p = State.predictions.find((x) => x.id === id);
  if (!p) return;
  window.UI.card("Verifying prediction #" + id, `<div class="checking">Fetching record from 0G Storage…</div>`);

  try {
    const record = p.record ?? (await (await fetch(CFG.storageGateway + p.storageRoot)).json());
    p.record = record;

    const computed = ethers.keccak256(ethers.toUtf8Bytes(canonicalJSON(record)));
    const hashOk = computed.toLowerCase() === p.recordHash.toLowerCase();
    const preKickoff = p.committedAt < p.kickoff;
    const tee = record.provenance?.teeSignatureValid === true;
    const allOk = hashOk && preKickoff && tee;
    const m = record.match;

    window.UI.card(
      `${m.home} vs ${m.away}`,
      `
      <div class="verdict ${allOk ? "ok" : "bad"}">${allOk ? "✓ VERIFIED ON-CHAIN" : "✗ VERIFICATION FAILED"}</div>
      ${check("Record integrity", hashOk, "keccak(record) == on-chain commit")}
      <div class="hashes">
        <div><span>computed</span><code>${short(computed)}</code></div>
        <div><span>on-chain</span><code>${short(p.recordHash)}</code></div>
      </div>
      ${check("Committed before kickoff", preKickoff, `${fmtTs(p.committedAt)} &lt; ${fmtTs(p.kickoff)}`)}
      ${check("Produced inside a TEE", tee, `${record.provenance.model}`)}
      ${agentLine(record)}
      ${inftLine(p)}
      ${debateHTML(record)}
      <div class="rationale">“${record.prediction.rationale}”
        <span class="muted">— ${(record.prediction.confidence * 100).toFixed(0)}% confidence, called ${record.prediction.scoreline}</span></div>
      <div class="links">
        <a href="${CFG.storageGateway + p.storageRoot}" target="_blank" rel="noopener">record on 0G Storage ↗</a>
        <a href="${CFG.explorerAddr}${CFG.contract}" target="_blank" rel="noopener">contract ↗</a>
      </div>`,
    );
  } catch (e) {
    window.UI.card("Verification", `<div class="verdict bad">✗ Could not verify</div><div class="muted">${e.message}</div>`);
  }
}

function debateHTML(record) {
  const d = record.debate;
  if (!d?.panel?.length) return "";
  const rows = d.panel
    .map(
      (a) => `
      <div class="dbt">
        <div class="dbt-top"><b>${a.agent}</b> <span class="muted">${a.role}</span>
          <span class="dbt-call">${a.outcome} ${a.scoreline} · ${Math.round(a.confidence * 100)}%</span></div>
        <div class="dbt-take">“${a.take}”</div>
      </div>`,
    )
    .join("");
  return `<div class="debate">
    <div class="debate-h">⚖ The panel debated this call</div>
    ${rows}
    <div class="dbt judge">
      <div class="dbt-top"><b>◆ The Oracle</b> <span class="muted">judge · final verdict</span></div>
      <div class="dbt-take">“${d.consensus}”</div>
    </div>
  </div>`;
}

function agentLine(record) {
  if (!record.agentId) return "";
  const did = record.agentId.length > 30 ? record.agentId.slice(0, 16) + "…" + record.agentId.slice(-6) : record.agentId;
  const card = record.agentCardRoot
    ? ` · <a href="${CFG.storageGateway}${record.agentCardRoot}" target="_blank" rel="noopener">identity card ↗</a>`
    : "";
  return `<div class="agentline">🪪 Signed by agent <code>${did}</code> (0G Agentic ID)${card}</div>`;
}

function inftLine(p) {
  if (p.inftTokenId == null) return "";
  return `<div class="agentline">🪙 Minted as soulbound iNFT <code>#${p.inftTokenId}</code> on 0G Chain, bound to the Agentic ID · <a href="${CFG.explorerAddr}${CFG.inft}" target="_blank" rel="noopener">contract ↗</a></div>`;
}

function check(label, ok, detail) {
  return `<div class="check ${ok ? "ok" : "bad"}">
    <span class="tick">${ok ? "✓" : "✗"}</span>
    <span class="label">${label}</span>
    <span class="detail muted">${detail}</span>
  </div>`;
}

window.OracleVerify = verify;
wireTabs();
main();
setInterval(main, 30000);
