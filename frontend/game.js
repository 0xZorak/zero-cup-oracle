/* Beat the Oracle — a pick'em game played against the agent's real on-chain
   calls. You pick a match outcome; only then does it reveal the Oracle's pick
   and the actual result, and score you against the Oracle's accuracy. Picks are
   stored locally (no wallet), so you can't peek-then-change. */
(function () {
  const CFG = window.ORACLE_CONFIG;
  const OUTCOME = ["HOME", "DRAW", "AWAY"];
  const KEY = "oracle_game_picks_v1";

  const ABI = [
    "function getPrediction(uint256 id) view returns (tuple(uint256 matchId, bytes32 recordHash, bytes32 storageRoot, uint64 kickoff, uint64 committedAt, uint8 predicted, uint8 actual, uint8 status))",
    "function totalPredictions() view returns (uint256)",
  ];
  const provider = new ethers.JsonRpcProvider(CFG.rpc, CFG.chainId);
  const oracle = new ethers.Contract(CFG.contract, ABI, provider);

  const loadPicks = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const savePick = (id, choice) => {
    const p = loadPicks();
    p[id] = choice;
    localStorage.setItem(KEY, JSON.stringify(p));
  };

  let matches = []; // { id, home, away, kickoff, oracle, actual, status }

  async function fetchMatches() {
    // Reuse the data app.js already loaded (predictions + records) — instant.
    const shared = window.OracleData?.predictions ?? [];
    if (shared.length) {
      return shared.map((p) => ({
        id: p.id,
        home: p.record?.match.home ?? `Match #${p.id}`,
        away: p.record?.match.away ?? "",
        kickoff: p.kickoff,
        oracle: p.predicted,
        actual: p.actual,
        status: p.status,
      }));
    }
    // Fallback: fetch directly if app.js hasn't populated yet.
    const total = Number(await oracle.totalPredictions());
    const out = [];
    for (let id = total - 1; id >= 0; id--) {
      const p = await oracle.getPrediction(id);
      let home = `Match #${id}`,
        away = "";
      try {
        const rec = await (await fetch(CFG.storageGateway + p.storageRoot)).json();
        home = rec.match.home;
        away = rec.match.away;
      } catch {
        /* gateway hiccup — show generic */
      }
      out.push({
        id,
        home,
        away,
        kickoff: Number(p.kickoff),
        oracle: OUTCOME[Number(p.predicted)],
        actual: OUTCOME[Number(p.actual)],
        status: ["Pending", "Correct", "Wrong"][Number(p.status)],
      });
    }
    return out;
  }

  function tally() {
    const picks = loadPicks();
    let played = 0,
      youRight = 0,
      oracleRight = 0,
      pending = 0;
    for (const m of matches) {
      if (!(m.id in picks)) continue;
      if (m.status === "Pending") {
        pending++;
        continue;
      }
      played++;
      if (picks[m.id] === m.actual) youRight++;
      if (m.oracle === m.actual) oracleRight++;
    }
    return { played, youRight, oracleRight, pending };
  }

  function renderHead() {
    const t = tally();
    const youPct = t.played ? Math.round((t.youRight / t.played) * 100) : 0;
    const oraPct = t.played ? Math.round((t.oracleRight / t.played) * 100) : 0;
    let verdict = "Make your picks — then see if you can beat the Oracle.";
    if (t.played > 0) {
      if (t.youRight > t.oracleRight) verdict = "🏆 You're beating the Oracle!";
      else if (t.youRight < t.oracleRight) verdict = "🔮 The Oracle is ahead. Keep going.";
      else verdict = "🤝 Dead level with the Oracle.";
    }
    return `
      <div class="g-score">
        <div class="g-team"><b>YOU</b><span>${t.youRight}/${t.played} · ${youPct}%</span></div>
        <div class="g-vs">vs</div>
        <div class="g-team oracle"><b>◆ ORACLE</b><span>${t.oracleRight}/${t.played} · ${oraPct}%</span></div>
      </div>
      <div class="g-verdict">${verdict}${t.pending ? ` <span class="muted">· ${t.pending} pick(s) awaiting result</span>` : ""}</div>`;
  }

  function renderRow(m) {
    const picks = loadPicks();
    const mine = picks[m.id];
    const teams = m.away ? `${m.home} <span class="muted">vs</span> ${m.away}` : m.home;

    if (mine === undefined) {
      return `<div class="g-row" data-id="${m.id}">
        <div class="g-match">${teams}</div>
        <div class="g-picks">
          ${OUTCOME.map((o) => `<button class="g-pick" data-id="${m.id}" data-o="${o}">${o}</button>`).join("")}
        </div>
      </div>`;
    }

    // Revealed state
    const resolved = m.status !== "Pending";
    const youOk = resolved && mine === m.actual;
    const oraOk = resolved && m.oracle === m.actual;
    const badge = (label, val, ok) =>
      `<span class="g-tag ${resolved ? (ok ? "ok" : "bad") : "pend"}">${label}: ${val}${resolved ? (ok ? " ✓" : " ✗") : ""}</span>`;
    return `<div class="g-row revealed" data-id="${m.id}">
      <div class="g-match">${teams}</div>
      <div class="g-reveal">
        ${badge("You", mine, youOk)}
        ${badge("Oracle", m.oracle, oraOk)}
        ${resolved ? `<span class="g-tag actual">Result: ${m.actual}</span>` : `<span class="g-tag pend">awaiting kickoff/result</span>`}
      </div>
    </div>`;
  }

  function render() {
    document.getElementById("game-score").innerHTML = renderHead();
    const list = document.getElementById("game-list");
    if (matches.length === 0) {
      list.innerHTML = `<p class="empty">The Oracle hasn't called any matches yet. Run the agent, then play.</p>`;
      return;
    }
    list.innerHTML = matches.map(renderRow).join("");
    list.querySelectorAll(".g-pick").forEach((b) =>
      b.addEventListener("click", () => {
        savePick(b.dataset.id, b.dataset.o);
        render();
      }),
    );
  }

  async function open() {
    window.UI.openWindow(document.getElementById("game-window"));
    document.getElementById("game-list").innerHTML = `<p class="empty">Loading the Oracle's calls…</p>`;
    try {
      matches = await fetchMatches();
    } catch (e) {
      document.getElementById("game-list").innerHTML = `<p class="empty">Couldn't reach 0G Chain: ${e.message}</p>`;
      return;
    }
    render();
  }
  const close = () => window.UI.closeWindow(document.getElementById("game-window"));
  const reset = () => {
    localStorage.removeItem(KEY);
    render();
  };

  window.OracleGame = { open, close, reset };
})();
