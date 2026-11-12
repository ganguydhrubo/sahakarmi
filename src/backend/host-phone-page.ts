/**
 * The page a paired phone opens. Plain files, no framework, served by Sahkarmi Host from this PC.
 * Everything from the PC (names, messages, requests) is put on screen with textContent, never as
 * HTML, so nothing a coworker writes can run on the phone.
 */

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><clipPath id="l"><rect x="14" y="30" width="58" height="74" rx="29"/></clipPath></defs><rect width="120" height="120" rx="28" fill="#0f1220"/><rect x="14" y="30" width="58" height="74" rx="29" fill="#3a4a8c"/><rect x="48" y="16" width="58" height="74" rx="29" fill="#E8772E"/><rect x="48" y="16" width="58" height="74" rx="29" fill="#8E3F1E" clip-path="url(#l)"/></svg>`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1220">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>Sahkarmi</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="offline" class="offline" hidden role="status">Can't reach your PC. Check it is on, with Sahkarmi Host turned on.</div>

<main id="pair" class="pair" hidden>
  <img class="pair-logo" src="/icon.svg" alt="" width="72" height="72">
  <h1>Use Sahkarmi from your phone</h1>
  <p class="lead">On your PC, open <b>Settings → Phone &amp; Host</b> and press <b>Pair a phone</b>. Scan the QR code, or type the code here.</p>
  <form id="pair-form" class="pair-form" autocomplete="off">
    <label for="pair-code">Code from your PC</label>
    <input id="pair-code" inputmode="text" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="•••• ••••" required>
    <label for="pair-name">Name for this phone</label>
    <input id="pair-name" maxlength="40" placeholder="My phone">
    <button id="pair-button" class="primary big" type="submit">Pair this phone</button>
    <p id="pair-error" class="error" role="alert" hidden></p>
  </form>
  <ol class="pair-steps">
    <li><b>Private.</b> Only your own devices can open this page.</li>
    <li><b>Safe.</b> Risky actions still wait for your Approve.</li>
    <li><b>Free.</b> No account, no company server in between.</li>
  </ol>
</main>

<div id="app" class="app" hidden>
  <header class="top">
    <img src="/icon.svg" alt="" width="30" height="30">
    <div class="top-title">
      <strong id="top-title">Needs you</strong>
      <span class="top-status"><i class="dot"></i><span id="top-status">Connected to your PC</span></span>
    </div>
    <button id="menu-button" class="icon-button" type="button" aria-label="More">⋯</button>
  </header>
  <div id="menu" class="menu" hidden>
    <button id="unpair" type="button">Unpair this phone</button>
  </div>

  <section id="tab-approvals" class="tab" aria-labelledby="nav-approvals">
    <div id="approvals"></div>
  </section>

  <section id="tab-chat" class="tab" hidden aria-labelledby="nav-chat">
    <div id="coworkers" class="list"></div>
    <div id="chat" class="chat" hidden>
      <div class="chat-head">
        <button id="chat-back" class="icon-button" type="button" aria-label="Back to coworkers">‹</button>
        <div><strong id="chat-name"></strong><small id="chat-busy"></small></div>
      </div>
      <div id="messages" class="messages" aria-live="polite"></div>
      <form id="composer" class="composer">
        <textarea id="composer-text" rows="1" maxlength="8000" placeholder="Message" aria-label="Message"></textarea>
        <button id="composer-send" class="send" type="submit" aria-label="Send">➤</button>
      </form>
    </div>
  </section>

  <section id="tab-routines" class="tab" hidden aria-labelledby="nav-routines">
    <div id="routines" class="list"></div>
  </section>

  <nav class="bottom" aria-label="Sections">
    <button id="nav-approvals" type="button" data-tab="approvals" class="active"><svg class="nav-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>Needs you<b id="badge" class="badge" hidden>0</b></button>
    <button id="nav-chat" type="button" data-tab="chat"><svg class="nav-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>Chat</button>
    <button id="nav-routines" type="button" data-tab="routines"><svg class="nav-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>Routines</button>
  </nav>
</div>
<div id="toast" class="toast" role="status" hidden></div>
<script src="/app.js"></script>
</body>
</html>
`;

const CSS = `:root {
  --bg: #fbf7f0; --card: #ffffff; --ink: #1b1d2a; --muted: #6b6f80; --line: rgba(27,29,42,.1);
  --brand: #e8772e; --brand-ink: #ffffff; --ok: #2e8b57; --bad: #c0392b; --mine: #1e2a5a; --mine-ink: #fbf7f0;
  --shadow: 0 1px 2px rgba(15,18,32,.06), 0 6px 20px rgba(15,18,32,.06);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1220; --card: #191d30; --ink: #eef0f7; --muted: #a2a7bd; --line: rgba(238,240,247,.1);
    --mine: #e8772e; --mine-ink: #1b1206; --shadow: 0 1px 2px rgba(0,0,0,.3); color-scheme: dark; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
.primary { background: var(--brand); color: var(--brand-ink); border: 0; border-radius: 14px; padding: 12px 18px; font-weight: 700; }
.primary:disabled { opacity: .5; }
.big { width: 100%; min-height: 52px; font-size: 17px; }
.error { color: var(--bad); font-weight: 600; margin: 4px 0 0; }
.offline { position: sticky; top: 0; z-index: 9; background: var(--bad); color: #fff; padding: 10px 16px; font-size: 14px; font-weight: 600; text-align: center; }

.pair { max-width: 440px; margin: 0 auto; padding: 32px 20px; padding-top: max(32px, env(safe-area-inset-top)); text-align: center; }
.pair-logo { border-radius: 20px; box-shadow: var(--shadow); }
.pair h1 { font-size: 26px; line-height: 1.2; margin: 18px 0 8px; }
.lead { color: var(--muted); margin: 0 0 22px; }
.pair-form { display: grid; gap: 8px; text-align: left; background: var(--card); padding: 18px; border-radius: 20px; box-shadow: var(--shadow); }
.pair-form label { font-size: 14px; font-weight: 600; color: var(--muted); margin-top: 6px; }
.pair-form input { width: 100%; min-width: 0; font: inherit; font-size: 18px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
#pair-code { font-size: 26px; letter-spacing: .18em; text-align: center; font-weight: 700; text-transform: uppercase; }
.pair-form .primary { margin-top: 12px; }
.pair-steps { list-style: none; padding: 0; margin: 22px 0 0; display: grid; gap: 8px; text-align: left; color: var(--muted); font-size: 14px; }
.pair-steps li { background: var(--card); border-radius: 14px; padding: 10px 14px; }
.pair-steps b { color: var(--ink); }

.app { min-height: 100%; padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
.top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 10px 16px; padding-top: max(10px, env(safe-area-inset-top)); background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
.top img { border-radius: 8px; }
.top-title { flex: 1; display: grid; line-height: 1.2; }
.top-title strong { font-size: 18px; }
.top-status { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
.offline-mode .dot { background: var(--bad); box-shadow: none; }
.icon-button { width: 40px; height: 40px; border-radius: 12px; border: 0; background: transparent; font-size: 22px; }
.icon-button:active { background: var(--line); }
.menu { position: absolute; right: 12px; top: 58px; z-index: 6; background: var(--card); border-radius: 14px; box-shadow: var(--shadow); padding: 6px; border: 1px solid var(--line); }
.menu button { border: 0; background: none; padding: 10px 14px; color: var(--bad); font-weight: 600; }

.tab { padding: 14px 14px 24px; max-width: 720px; margin: 0 auto; }
.empty { text-align: center; padding: 48px 16px; color: var(--muted); }
.empty-big { font-size: 44px; display: block; margin-bottom: 6px; }
.empty strong { display: block; color: var(--ink); font-size: 18px; margin-bottom: 4px; }

.card { background: var(--card); border-radius: 18px; padding: 16px; box-shadow: var(--shadow); margin-bottom: 12px; border: 1px solid var(--line); }
.card-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; margin-bottom: 6px; flex-wrap: wrap; }
.card h2 { font-size: 17px; margin: 0 0 6px; line-height: 1.3; }
.card p { margin: 0; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.risk { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; }
.amount { background: color-mix(in srgb, var(--brand) 16%, transparent); color: var(--brand); padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; }
.actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 14px; }
.actions button { min-height: 50px; border-radius: 14px; font-weight: 700; font-size: 16px; }
.reject { background: transparent; border: 1.5px solid var(--line); }
.approve { background: var(--ok); color: #fff; border: 0; }
.actions button:disabled { opacity: .5; }

.list { display: grid; gap: 10px; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; box-shadow: var(--shadow); min-height: 64px; }
.row:active { transform: scale(.99); }
.avatar { flex: none; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; font-weight: 800; color: #fff; font-size: 18px; }
.row-copy { flex: 1; min-width: 0; display: grid; }
.row-copy strong { font-size: 16px; }
.row-copy small { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chev { color: var(--muted); font-size: 22px; }
.run { flex: none; background: var(--brand); color: var(--brand-ink); border: 0; border-radius: 12px; padding: 10px 14px; font-weight: 700; min-height: 44px; }
.run:disabled { opacity: .5; }
.status-done { color: var(--ok); }
.status-failed { color: var(--bad); }

.chat { display: flex; flex-direction: column; min-height: calc(100vh - 180px); }
.chat-head { display: flex; align-items: center; gap: 8px; margin: -4px 0 8px; }
.chat-head div { display: grid; line-height: 1.2; }
.chat-head small { color: var(--muted); font-size: 12px; }
.messages { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 4px 0 12px; }
.bubble { max-width: 86%; padding: 10px 13px; border-radius: 18px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--card); border: 1px solid var(--line); align-self: flex-start; border-bottom-left-radius: 6px; }
.bubble.mine { align-self: flex-end; background: var(--mine); color: var(--mine-ink); border-color: transparent; border-bottom-left-radius: 18px; border-bottom-right-radius: 6px; }
.bubble time { display: block; font-size: 11px; opacity: .65; margin-top: 4px; }
.note-line { align-self: center; max-width: 92%; text-align: center; color: var(--muted); font-size: 13px; padding: 4px 12px; border-radius: 999px; background: var(--line); }
.typing { align-self: flex-start; color: var(--muted); font-size: 14px; padding: 4px 6px; }
.composer { position: sticky; bottom: calc(72px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: flex-end; background: var(--bg); padding: 8px 0; }
.composer textarea { flex: 1; min-width: 0; font: inherit; resize: none; max-height: 140px; padding: 12px 14px; border-radius: 22px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.send { flex: none; width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--brand); color: var(--brand-ink); font-size: 20px; }
.send:disabled { opacity: .4; }

.bottom { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(3, 1fr); background: var(--card); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }
.bottom button { position: relative; border: 0; background: none; padding: 8px 4px 10px; display: grid; justify-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--muted); min-height: 62px; }
.bottom button.active { color: var(--brand); }
.nav-icon { display: block; }
.badge { position: absolute; top: 4px; left: calc(50% + 8px); min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--bad); color: #fff; font-size: 12px; display: grid; place-items: center; }
.toast { position: fixed; left: 50%; bottom: calc(86px + env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 10px 16px; border-radius: 999px; font-weight: 600; font-size: 14px; z-index: 10; max-width: calc(100% - 32px); text-align: center; }
@media (prefers-reduced-motion: no-preference) { .card, .row, .bubble { animation: rise .18s ease-out; } @keyframes rise { from { opacity: 0; transform: translateY(4px); } } }
`;

const JS = String.raw`"use strict";
(function () {
  var KEY = "sahkarmi-host-key";
  var COLORS = ["#e8772e", "#3a4a8c", "#2e8b57", "#8e3f1e", "#7b4bb7", "#1f7a8c", "#c0392b"];
  var key = null;
  var previousKey = null;
  try { key = localStorage.getItem(KEY); } catch (e) { key = null; }
  var state = { tab: "approvals", overview: null, chatBot: null, busyIds: {}, timer: null, chatTimer: null, offline: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function toast(text) {
    var box = $("toast"); box.textContent = text; box.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { box.hidden = true; }, 2600);
  }
  function when(iso) {
    if (!iso) return "";
    var date = new Date(iso); if (isNaN(date.getTime())) return "";
    var now = new Date();
    var sameDay = date.toDateString() === now.toDateString();
    return sameDay ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function colorFor(text) { var sum = 0; for (var i = 0; i < text.length; i++) sum += text.charCodeAt(i); return COLORS[sum % COLORS.length]; }
  function avatar(name) { var box = el("span", "avatar", (name || "?").trim().charAt(0).toUpperCase()); box.style.background = colorFor(name || "?"); box.setAttribute("aria-hidden", "true"); return box; }
  function setOffline(offline) {
    state.offline = offline; $("offline").hidden = !offline;
    document.body.classList.toggle("offline-mode", offline);
    $("top-status").textContent = offline ? "Not connected" : "Connected to your PC";
  }

  function api(path, body) {
    var options = { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + key }, cache: "no-store" };
    if (body) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
    return fetch(path, options).then(function (response) {
      setOffline(false);
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.status === 401) { forget(); throw new Error(data.error || "Pair this phone again."); }
        if (!response.ok) throw new Error(data.error || "Your PC could not do that.");
        return data;
      });
    }, function () { setOffline(true); throw new Error("Can't reach your PC right now."); });
  }

  function forget() {
    key = null; try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    stopPolling(); showPair();
  }

  function showPair(code) {
    $("app").hidden = true; $("pair").hidden = false;
    if (code) $("pair-code").value = code;
    if (!$("pair-name").value) {
      var ua = navigator.userAgent;
      $("pair-name").value = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : "Phone";
    }
    if (code) pair(); else $("pair-code").focus();
  }

  function pair() {
    var button = $("pair-button"), error = $("pair-error");
    var code = $("pair-code").value.replace(/[\s-]/g, "").toUpperCase();
    if (code.length < 8) { error.textContent = "The code has 8 letters and numbers."; error.hidden = false; return; }
    button.disabled = true; button.textContent = "Pairing…"; error.hidden = true;
    fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ code: code, name: $("pair-name").value, previousKey: previousKey }) })
      .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "Pairing failed."); return data; }); })
      .then(function (data) {
        key = data.key; previousKey = null; try { localStorage.setItem(KEY, key); } catch (e) { /* the key lives for this visit only */ }
        showApp(); toast("Paired. This phone can now use Sahkarmi.");
      })
      .catch(function (cause) { error.textContent = cause.message === "Failed to fetch" ? "Can't reach your PC. Check it is on." : cause.message; error.hidden = false; })
      .then(function () { button.disabled = false; button.textContent = "Pair this phone"; });
  }

  function showApp() {
    $("pair").hidden = true; $("app").hidden = false;
    selectTab(state.tab); refresh(); startPolling();
  }

  function startPolling() {
    stopPolling();
    state.timer = setInterval(function () { if (!document.hidden) refresh(); }, 5000);
  }
  function stopPolling() { clearInterval(state.timer); clearInterval(state.chatTimer); state.timer = null; state.chatTimer = null; }

  function refresh() {
    if (!key) return;
    api("/api/overview").then(function (data) { state.overview = data; render(); }).catch(function () { /* banner shows */ });
  }

  function selectTab(tab) {
    state.tab = tab;
    ["approvals", "chat", "routines"].forEach(function (name) {
      $("tab-" + name).hidden = name !== tab;
      var button = $("nav-" + name); button.classList.toggle("active", name === tab);
      if (name === tab) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    $("top-title").textContent = tab === "approvals" ? "Needs you" : tab === "chat" ? "Chat" : "Routines";
    if (tab !== "chat") closeChat();
    window.scrollTo(0, 0);
  }

  function render() {
    var data = state.overview; if (!data) return;
    var count = data.approvals.length;
    $("badge").hidden = count === 0; $("badge").textContent = count > 9 ? "9+" : String(count);
    document.title = count ? "(" + count + ") Sahkarmi" : "Sahkarmi";
    renderApprovals(data.approvals); renderCoworkers(data.coworkers); renderRoutines(data.routines);
  }

  function empty(icon, title, text) {
    var box = el("div", "empty"); box.appendChild(el("span", "empty-big", icon)); box.appendChild(el("strong", "", title)); box.appendChild(el("span", "", text)); return box;
  }

  function renderApprovals(items) {
    var host = $("approvals"); clear(host);
    if (!items.length) { host.appendChild(empty("✓", "Nothing needs you", "When a coworker asks before doing something, it shows up here.")); return; }
    items.forEach(function (item) {
      var card = el("article", "card");
      var meta = el("div", "card-meta"); meta.appendChild(el("span", "", item.coworker + " asks · " + when(item.createdAt)));
      if (item.risk === "high") meta.appendChild(el("span", "risk", "Check carefully"));
      if (item.amount) meta.appendChild(el("span", "amount", item.amount));
      card.appendChild(meta); card.appendChild(el("h2", "", item.title));
      if (item.details) card.appendChild(el("p", "", item.details));
      var actions = el("div", "actions");
      var reject = el("button", "reject", "Reject"); reject.type = "button";
      var approve = el("button", "approve", "Approve"); approve.type = "button";
      var busy = !!state.busyIds[item.id]; reject.disabled = busy; approve.disabled = busy;
      reject.onclick = function () { decide(item, "rejected"); };
      approve.onclick = function () { decide(item, "approved"); };
      actions.appendChild(reject); actions.appendChild(approve); card.appendChild(actions); host.appendChild(card);
    });
  }

  function decide(item, decision) {
    state.busyIds[item.id] = true; render();
    api("/api/approval", { approvalId: item.id, decision: decision })
      .then(function () { toast(decision === "approved" ? "Approved. " + item.coworker + " carries on." : "Rejected. " + item.coworker + " will not do it."); })
      .catch(function (cause) { toast(cause.message); })
      .then(function () { delete state.busyIds[item.id]; refresh(); });
  }

  function renderCoworkers(items) {
    var host = $("coworkers"); clear(host);
    if (!items.length) { host.appendChild(empty("👋", "No coworkers yet", "Add coworkers on your PC first.")); return; }
    items.forEach(function (bot) {
      var row = el("button", "row"); row.type = "button";
      row.appendChild(avatar(bot.name));
      var copy = el("span", "row-copy"); copy.appendChild(el("strong", "", bot.name)); copy.appendChild(el("small", "", bot.preview || bot.role || "Say hello"));
      row.appendChild(copy); row.appendChild(el("span", "chev", "›"));
      row.onclick = function () { openChat(bot); };
      host.appendChild(row);
    });
  }

  function openChat(bot) {
    state.chatBot = bot; $("coworkers").hidden = true; $("chat").hidden = false;
    $("chat-name").textContent = bot.name; $("chat-busy").textContent = bot.role || "";
    clear($("messages")); loadChat(true);
    clearInterval(state.chatTimer); state.chatTimer = setInterval(function () { if (!document.hidden) loadChat(false); }, 3000);
  }
  function closeChat() { state.chatBot = null; clearInterval(state.chatTimer); state.chatTimer = null; $("chat").hidden = true; $("coworkers").hidden = false; }

  var lastChat = "";
  function loadChat(scroll) {
    var bot = state.chatBot; if (!bot) return;
    api("/api/chat?bot=" + encodeURIComponent(bot.id)).then(function (data) {
      if (!state.chatBot || state.chatBot.id !== bot.id) return;
      var signature = JSON.stringify(data);
      if (signature === lastChat && !scroll) return; lastChat = signature;
      var nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
      var host = $("messages"); clear(host);
      if (!data.messages.length) host.appendChild(empty("💬", "Start the chat", "Ask " + bot.name + " for anything, like you would on your PC."));
      data.messages.forEach(function (message) {
        if (message.note) { host.appendChild(el("div", "note-line", message.text)); return; }
        var bubble = el("div", "bubble" + (message.mine ? " mine" : ""), message.text);
        bubble.appendChild(el("time", "", when(message.at))); host.appendChild(bubble);
      });
      if (data.busy) host.appendChild(el("div", "typing", bot.name + " is working…"));
      $("chat-busy").textContent = data.busy ? "Working…" : bot.role || "";
      if (scroll || nearBottom) window.scrollTo(0, document.body.scrollHeight);
    }).catch(function () { /* banner shows */ });
  }

  function send(event) {
    event.preventDefault();
    var box = $("composer-text"), text = box.value.trim(), bot = state.chatBot;
    if (!text || !bot) return;
    $("composer-send").disabled = true;
    api("/api/chat", { botId: bot.id, text: text })
      .then(function () { box.value = ""; grow(); loadChat(true); })
      .catch(function (cause) { toast(cause.message); })
      .then(function () { $("composer-send").disabled = false; });
  }
  function grow() { var box = $("composer-text"); box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 140) + "px"; }

  function renderRoutines(items) {
    var host = $("routines"); clear(host);
    if (!items.length) { host.appendChild(empty("↻", "No routines yet", "Make a routine on your PC, then run it from here any time.")); return; }
    items.forEach(function (routine) {
      var row = el("div", "row");
      row.appendChild(avatar(routine.name));
      var copy = el("span", "row-copy"); copy.appendChild(el("strong", "", routine.name));
      var info = routine.steps + (routine.steps === 1 ? " step" : " steps");
      if (routine.lastRunAt) info += " · last run " + when(routine.lastRunAt);
      var small = el("small", routine.lastStatus ? "status-" + routine.lastStatus : "", info + (routine.lastStatus === "failed" ? " · failed" : ""));
      copy.appendChild(small); row.appendChild(copy);
      var run = el("button", "run", "Run now"); run.type = "button";
      run.onclick = function () {
        run.disabled = true; run.textContent = "Starting…";
        api("/api/routine", { routineId: routine.id })
          .then(function () { toast(routine.name + " started on your PC."); })
          .catch(function (cause) { toast(cause.message); })
          .then(function () { run.disabled = false; run.textContent = "Run now"; refresh(); });
      };
      row.appendChild(run); host.appendChild(row);
    });
  }

  $("pair-form").addEventListener("submit", function (event) { event.preventDefault(); pair(); });
  $("pair-code").addEventListener("input", function () { var box = $("pair-code"); box.value = box.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""); });
  Array.prototype.forEach.call(document.querySelectorAll(".bottom button"), function (button) {
    button.addEventListener("click", function () { selectTab(button.getAttribute("data-tab")); });
  });
  $("chat-back").addEventListener("click", closeChat);
  $("composer").addEventListener("submit", send);
  $("composer-text").addEventListener("input", grow);
  $("composer-text").addEventListener("keydown", function (event) { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send(event); });
  $("menu-button").addEventListener("click", function () { $("menu").hidden = !$("menu").hidden; });
  $("unpair").addEventListener("click", function () {
    $("menu").hidden = true;
    if (!confirm("Unpair this phone? You can pair it again from your PC.")) return;
    api("/api/unpair", {}).catch(function () { /* forget locally anyway */ }).then(forget);
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && key) { refresh(); loadChat(false); } });

  // The QR link carries the code after #, which never leaves the phone. Read it, then hide it.
  function codeFromLink() {
    var match = /[#&]pair=([A-Za-z0-9]{8})/.exec(location.hash);
    if (match) history.replaceState(null, "", location.pathname);
    return match ? match[1].toUpperCase() : null;
  }
  window.addEventListener("hashchange", function () {
    var code = codeFromLink();
    if (code) { forgetQuietly(); stopPolling(); showPair(code); }
  });
  var linkCode = codeFromLink();
  if (linkCode) { forgetQuietly(); showPair(linkCode); }
  else if (key) showApp();
  else showPair();

  // Keeps the old key in memory only, so pairing again replaces this phone's entry on the PC.
  function forgetQuietly() { if (key) previousKey = key; key = null; try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
})();
`;

const MANIFEST = JSON.stringify({
  name: "Sahkarmi",
  short_name: "Sahkarmi",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0f1220",
  theme_color: "#0f1220",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
});

export const PHONE_FILES: Record<string, { type: string; body: string }> = {
  "/index.html": { type: "text/html; charset=utf-8", body: HTML },
  "/app.css": { type: "text/css; charset=utf-8", body: CSS },
  "/app.js": { type: "text/javascript; charset=utf-8", body: JS },
  "/manifest.webmanifest": { type: "application/manifest+json", body: MANIFEST },
  "/icon.svg": { type: "image/svg+xml", body: ICON_SVG },
};
