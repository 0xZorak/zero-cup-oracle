/* Ask the Oracle — a client-side agent that answers questions about the
   predictions from the data already stored on 0G (the panel debate, the
   rationale, the on-chain status, the running accuracy). No wallet, no keys:
   it reasons over window.OracleData, which app.js keeps in sync with chain. */
(function () {
  const log = () => document.getElementById("chat-log");
  const OUT = { HOME: "a home win", DRAW: "a draw", AWAY: "an away win" };

  const preds = () => window.OracleData?.predictions ?? [];
  const withRecord = () => preds().filter((p) => p.record);

  function add(role, html) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = html;
    log().appendChild(el);
    log().scrollTop = log().scrollHeight;
    return el;
  }

  function teamMatch(q) {
    const ql = q.toLowerCase();
    for (const p of withRecord()) {
      const { home, away } = p.record.match;
      if (ql.includes(home.toLowerCase()) || ql.includes(away.toLowerCase())) return p;
    }
    return null;
  }

  function scoreboardLine() {
    const ps = preds();
    const resolved = ps.filter((p) => p.status !== "Pending");
    const correct = resolved.filter((p) => p.status === "Correct").length;
    const acc = resolved.length ? Math.round((correct / resolved.length) * 100) : 0;
    return `I've committed <b>${ps.length}</b> call(s) on-chain. Resolved: <b>${correct}/${resolved.length}</b>` +
      (resolved.length ? ` — that's <b>${acc}%</b> accurate, and every bit of it is provable.` : `. None resolved yet — the record speaks once the matches finish.`);
  }

  function explainMatch(p) {
    const r = p.record;
    const d = r.debate;
    let html = `For <b>${r.match.home} vs ${r.match.away}</b>, I called <b>${OUT[p.predicted]}</b> ` +
      `(${r.prediction.scoreline}) at <b>${Math.round(r.prediction.confidence * 100)}%</b> confidence. ` +
      `<span class="muted">“${r.prediction.rationale}”</span>`;
    if (d?.panel?.length) {
      html += `<div class="chat-panel"><div class="muted">My ${d.panel.length}-agent panel debated it:</div>`;
      for (const a of d.panel) {
        html += `<div>• <b>${a.agent}</b>: ${a.outcome} ${a.scoreline} <span class="muted">— ${a.take}</span></div>`;
      }
      html += `<div>• <b>◆ As judge</b>: <span class="muted">${d.consensus}</span></div></div>`;
    }
    const verdict =
      p.status === "Pending" ? `It's committed and awaiting kickoff/result.`
      : p.status === "Correct" ? `✅ And I <b>called it</b> — it's on the record.`
      : `❌ I <b>missed this one</b>. It's on-chain too; I don't hide the misses.`;
    html += `<div style="margin-top:8px">${verdict} <button class="chat-verify" data-id="${p.id}">Verify #${p.id} ✦</button></div>`;
    return html;
  }

  function listMatches() {
    const ps = withRecord();
    if (!ps.length) return `I haven't published any calls the page can read yet. Try again once the agent has run.`;
    return `Ask me about any of these — e.g. <i>“why did you pick ${ps[0].record.match.home}?”</i><div class="chat-panel">` +
      ps.map((p) => `• <b>${p.record.match.home} vs ${p.record.match.away}</b> — I said ${p.predicted}`).join("") + `</div>`;
  }

  function respond(q) {
    const ql = q.toLowerCase().trim();
    const team = teamMatch(q);
    if (team) return explainMatch(team);
    if (/(accuracy|record|how good|how accurate|track|stats?|score)/.test(ql)) return scoreboardLine();
    if (/(fake|trust|prove|proof|verif|real|cheat|tamper)/.test(ql))
      return `You never have to trust me. Every call is hashed and committed on-chain <b>before kickoff</b>, ` +
        `and the full record sits on 0G Storage. Hit <b>Verify</b> on any prediction — your browser re-fetches ` +
        `the record, recomputes the hash, and checks it against the chain. Nothing routes through my server.`;
    if (/(how|work|what are you|who are you|tee|0g|panel|debate|agent)/.test(ql))
      return `I'm an autonomous panel. Three analyst agents — <b>The Statistician</b>, <b>The Tactician</b>, ` +
        `<b>The Contrarian</b> — each reason inside a TEE, then I (the judge) commit one verdict on-chain before kickoff. ` +
        `Integrity is proven by 0G; quality is proven by my scoreboard over time.`;
    if (/(beat|game|play|pick)/.test(ql))
      return `Think you're sharper than me? Open <b>Beat the Oracle</b> from the desktop and pick the matches yourself — ` +
        `then we compare records. 😏`;
    if (/(hi|hey|hello|sup|yo)\b/.test(ql))
      return `I am THE ORACLE. I call matches before kickoff and put every call on-chain. ${scoreboardLine()}<br><br>${listMatches()}`;
    return `I can explain any call I've made, my accuracy, or how the verification works.<br><br>${listMatches()}`;
  }

  function send() {
    const input = document.getElementById("chat-input");
    const q = input.value.trim();
    if (!q) return;
    add("user", q.replace(/</g, "&lt;"));
    input.value = "";
    const thinking = add("bot thinking", `<span class="dots"><i></i><i></i><i></i></span>`);
    setTimeout(() => {
      thinking.remove();
      const el = add("bot", respond(q));
      el.querySelectorAll(".chat-verify").forEach((b) =>
        b.addEventListener("click", () => window.OracleVerify(Number(b.dataset.id))),
      );
    }, 480);
  }

  function open() {
    window.UI.openWindow(document.getElementById("chat-window"));
    if (!log().dataset.greeted) {
      add("bot", `I am <b>THE ORACLE</b>. Ask me why I made a call, how accurate I am, or how to verify any of it.<br><br>${listMatches()}`);
      log().dataset.greeted = "1";
    }
    document.getElementById("chat-input").focus();
  }
  const close = () => window.UI.closeWindow(document.getElementById("chat-window"));

  window.OracleChat = { open, close, send };
})();
