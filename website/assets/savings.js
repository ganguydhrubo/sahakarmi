/* Sahkarmi savings calculator page. Everything runs in the browser; the only network requests are
   /assets/fx.json on this site and, when the visitor clicks the button, today's rates from Frankfurter. */
(function () {
  "use strict";
  const C = window.SavingsCalc;
  const STORE = "sahkarmi.savings.v1";
  const FX_STORE = "sahkarmi.savings.fx";

  // The closing note under the results. Change or add lines freely: {days} and {hours} are filled in.
  const WITTY = {
    big: "That is about <b>{days} working days</b> back every year. Enough for a proper holiday, or one very long lunch.",
    medium: "About <b>{days} working days</b> a year. Not a holiday yet, but a lot of Friday afternoons.",
    small: "<b>{hours} hours</b> a year. Small, but it adds up. Sadly, no tool can make meetings shorter yet.",
    none: "No saving yet. Sometimes the fastest way really is to just do it yourself.",
  };

  const FIELDS = {
    monthlyPay: { min: 0, max: 100000000, label: "Monthly pay" },
    hourlyRate: { min: 0, max: 1000000, label: "Value per hour" },
    hoursPerDay: { min: 1, max: 24, label: "Working hours a day" },
    daysPerWeek: { min: 1, max: 7, label: "Working days a week", int: true },
    weeksPerYear: { min: 1, max: 52, label: "Working weeks a year", int: true },
    cardMarkupPct: { min: 0, max: 20, label: "Card fee" },
    limitShare: { min: 0, max: 100, label: "Work free plans can handle" },
    freq: { min: 0, max: 1000, label: "How often" },
    manualMin: { min: 0, max: 1440, label: "Minutes by hand" },
    aiMin: { min: 0, max: 1440, label: "Minutes for the AI part" },
    reviewMin: { min: 0, max: 1440, label: "Minutes to review" },
    redoPct: { min: 0, max: 100, label: "Share redone by hand" },
    setupHours: { min: 0, max: 200, label: "Setup hours" },
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let fx = C.FX, state, pickId = null, lastRemoved = null, toastTimer;

  // ---------- storage (try/catch: private windows can block it) ----------
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const remove = (k) => { try { localStorage.removeItem(k); } catch { /* nothing saved */ } };

  let seq = 0;
  const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
  function makeTask(type) {
    const t = C.TASK_TYPES[type] || C.TASK_TYPES.custom;
    const { label, ...rest } = t;
    return { id: newId(), type, name: type === "custom" ? "" : label, ...rest };
  }
  function defaults() {
    return { mode: "simple", ...structuredClone(C.DEFAULTS), tasks: C.PROFESSIONS[C.DEFAULTS.profession].tasks.map(makeTask), tasksTouched: false };
  }
  function load() {
    const saved = read(STORE);
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.tasks)) return defaults();
    const base = defaults();
    const s = { ...base, ...saved };
    if (!C.CURRENCIES[s.currency]) s.currency = base.currency;
    if (!C.PROFESSIONS[s.profession]) s.profession = base.profession;
    s.tasks = saved.tasks.filter((t) => t && typeof t === "object").slice(0, 40).map((t) => ({ ...makeTask(C.TASK_TYPES[t.type] ? t.type : "custom"), ...t, id: newId() }));
    return s;
  }

  // ---------- formatting ----------
  function money(v, cur = state.currency, fixed) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    const c = C.CURRENCIES[cur];
    const digits = fixed ?? (Math.abs(v) >= 100 || cur === "INR" ? 0 : 2);
    const n = new Intl.NumberFormat(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
    return `${v < 0 ? "−" : ""}${c.symbol}${n}`;
  }
  const hrs = (v, d) => {
    const digits = d ?? (Math.abs(v) >= 100 ? 0 : 1);
    return new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  };
  const plain = (v, d = 0) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(v);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pct = (v) => `${v < 0 ? "−" : ""}${plain(Math.abs(v) * 100)}%`;
  const dateText = (iso) => { const [y, m, d] = String(iso).split("-"); return d && m && y ? `${d}/${m}/${y}` : iso; };

  function animate(el, to, fmt) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = String(to);
    if (reduced || !Number.isFinite(from) || Math.abs(to - from) < 0.05) { el.textContent = fmt(to); return; }
    const start = performance.now(), dur = 550;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1 && el.dataset.v === String(to)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- validation ----------
  function check(key, raw) {
    const f = FIELDS[key];
    if (!f) return { value: raw, error: "" };
    const label = f.label;
    if (raw === "" || raw === null || raw === undefined) return { value: key === "monthlyPay" || key === "hourlyRate" ? 0 : f.min, error: `${label} is required.` };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { value: f.min, error: `${label} must be a number.` };
    if (n < f.min || n > f.max) return { value: Math.min(f.max, Math.max(f.min, n)), error: `${label} must be between ${plain(f.min)} and ${plain(f.max)}.` };
    if (f.int && !Number.isInteger(n)) return { value: Math.round(n), error: `${label} must be a whole number.` };
    return { value: n, error: "" };
  }
  function showError(input, errEl, msg) {
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (errEl) errEl.textContent = msg;
  }

  // ---------- building the form ----------
  function fillSelect(sel, entries, value) {
    sel.innerHTML = entries.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("");
  }

  function planChoices(el, key) {
    const paid = C.TOOLS.filter((t) => t.monthly > 0);
    el.innerHTML = paid.map((t) => `<label class="choice"><input type="checkbox" data-list="${key}" value="${t.id}" /><span>${esc(t.name)}<small>${esc(listed(t))}${t.from ? " (lowest tier)" : ""}</small></span></label>`).join("");
  }
  function listed(t) {
    if (!t.monthly) return "Free";
    const c = C.CURRENCIES[t.cur];
    const price = `${c.symbol}${new Intl.NumberFormat(c.locale).format(t.monthly)} / Month`;
    return t.annualMonthly ? `${price}, or ${c.symbol}${t.annualMonthly} / Month billed yearly` : price;
  }

  function taskHtml(t, i) {
    const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("");
    const num = (f, label, help, extra = "") => `<label class="field${extra}"><span>${label}</span><input type="number" inputmode="decimal" data-f="${f}" min="${FIELDS[f].min}" max="${FIELDS[f].max}" step="any" value="${esc(t[f])}" aria-describedby="e-${t.id}-${f}" /><span class="err" id="e-${t.id}-${f}" role="alert"></span>${help ? `<span class="help">${help}</span>` : ""}</label>`;
    const name = t.name || C.TASK_TYPES[t.type]?.label || `Task ${i + 1}`;
    return `<li class="task" data-id="${t.id}">
      <div class="task-top">
        <label class="field"><span>Task ${i + 1}*</span><input type="text" data-f="name" maxlength="60" value="${esc(t.name)}" placeholder="Enter task name, e.g. Weekly sales report" aria-describedby="e-${t.id}-name" /><span class="err" id="e-${t.id}-name" role="alert"></span></label>
        <button type="button" class="btn btn-danger icon-btn" data-remove title="Remove task" aria-label="Remove task: ${esc(name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
      </div>
      <div class="grid">
        <div class="field"><span id="l-${t.id}-freq">How often</span><div class="freq"><input type="number" inputmode="decimal" data-f="freq" min="0" max="1000" step="any" value="${esc(t.freq)}" aria-labelledby="l-${t.id}-freq" aria-describedby="e-${t.id}-freq" /><select data-f="per" aria-label="Per day, week or month">${opt({ day: "times a day", week: "times a week", month: "times a month" }, t.per)}</select></div><span class="err" id="e-${t.id}-freq" role="alert"></span></div>
        ${num("manualMin", "Minutes by hand, each time")}
        <label class="field"><span>How AI would help</span><select data-f="method">${opt(C.METHODS, t.method)}</select></label>
        <label class="field"><span>How reliable is AI here?</span><select data-f="fit">${opt(C.FITS, t.fit)}</select></label>
        ${num("aiMin", "Minutes for the AI part", "Writing the request and waiting.", " adv")}
        ${num("reviewMin", "Minutes to review", "Checking and fixing its output.", " adv")}
        ${num("redoPct", "Share redone by hand (%)", "Runs where the AI result is unusable.", " adv")}
        ${num("setupHours", "Setup hours (once)", "Prompts, testing, learning the tool.", " adv")}
      </div>
      <div class="task-foot" data-foot></div>
    </li>`;
  }

  function renderTasks() {
    const list = $("#tasks");
    list.innerHTML = state.tasks.length ? state.tasks.map(taskHtml).join("") : `<li class="empty">No tasks yet. Add a common task above or your own below.</li>`;
    for (const t of state.tasks) validateTask(t, list.querySelector(`[data-id="${t.id}"]`));
    renderSuggestions();
  }

  function renderSuggestions() {
    const prof = C.PROFESSIONS[state.profession];
    const have = new Set(state.tasks.map((t) => t.type));
    const order = [...prof.tasks, ...Object.keys(C.TASK_TYPES).filter((k) => k !== "custom" && !prof.tasks.includes(k))];
    $("#suggest").innerHTML = order.filter((k) => !have.has(k)).slice(0, 8)
      .map((k) => `<li><button type="button" class="chip" data-add="${k}"><span aria-hidden="true">+</span> ${esc(C.TASK_TYPES[k].label)}</button></li>`).join("");
  }

  function syncForm() {
    document.body.dataset.mode = state.mode;
    const form = $("#calc");
    for (const el of form.querySelectorAll("[data-k]")) {
      const k = el.dataset.k;
      if (el.type === "radio") el.checked = String(state[k]) === el.value;
      else if (el.type === "checkbox") el.checked = Boolean(state[k]);
      else el.value = state[k] ?? "";
    }
    for (const el of form.querySelectorAll("[data-list]")) el.checked = (state[el.dataset.list] || []).includes(el.value);
    for (const el of form.querySelectorAll("[data-list='compare']")) el.closest(".choice").hidden = state.owned.includes(el.value);
    $("#f-monthlyPay").hidden = state.payMode !== "monthly";
    $("#f-hourlyRate").hidden = state.payMode !== "hourly";
    const sym = C.CURRENCIES[state.currency].symbol.trim();
    for (const b of document.querySelectorAll(".cur-sym")) { b.textContent = sym; b.parentElement.style.setProperty("--pre", `${sym.length}ch`); }
    for (const k of Object.keys(FIELDS)) {
      const input = form.querySelector(`[data-k="${k}"]`);
      if (input) showError(input, $(`#e-${k}`), check(k, state[k]).error);
    }
  }

  function validateTask(t, li) {
    if (!li) return;
    for (const input of li.querySelectorAll("[data-f]")) {
      const f = input.dataset.f;
      const err = li.querySelector(`#e-${t.id}-${f}`);
      if (f === "name") showError(input, err, String(t.name).trim() ? "" : "Task name is required.");
      else if (FIELDS[f]) showError(input, err, check(f, t[f]).error);
    }
  }

  // Values the maths uses: invalid entries are replaced with the nearest valid value.
  function clean() {
    const s = { ...state };
    for (const k of ["monthlyPay", "hourlyRate", "hoursPerDay", "daysPerWeek", "weeksPerYear", "cardMarkupPct", "limitShare"]) s[k] = check(k, state[k]).value;
    s.tasks = state.tasks.map((t, i) => {
      const c = { ...t, name: String(t.name).trim() || C.TASK_TYPES[t.type]?.label || `Task ${i + 1}` };
      for (const f of ["freq", "manualMin", "aiMin", "reviewMin", "redoPct", "setupHours"]) c[f] = check(f, t[f]).value;
      return c;
    });
    return s;
  }

  // ---------- results ----------
  let liveTimer;
  function render() {
    const s = clean();
    const r = C.compute(s, fx);
    const best = r.options.find((o) => o.id === r.bestId);
    const pick = r.options.find((o) => o.id === pickId) || best;
    const T = best.result.typical;
    const hasTasks = r.tasks.length > 0;

    animate($("#sum-hours"), T.savedH, (v) => hrs(v));
    animate($("#sum-day"), T.perDay, (v) => hrs(v, 1));
    animate($("#sum-week"), T.perWeek, (v) => hrs(v, 1));
    animate($("#sum-year"), T.perYear, (v) => hrs(v, 0));
    animate($("#sum-value"), T.value, (v) => money(v));
    $("#sum-cost").textContent = best.toolCost ? money(best.toolCost) : `${money(0)} (free)`;
    animate($("#sum-net"), T.net, (v) => money(v));
    $("#sum-net-row").classList.toggle("neg", T.net < 0);
    $("#sum-kicker").textContent = best.id === "manual" ? "Hours back each month" : `Hours back each month with ${best.short}`;
    $("#mini-hours").textContent = `${hrs(T.savedH)} h`;
    $("#mini-net").textContent = money(T.net);

    const rec = $("#sum-rec");
    rec.classList.remove("warn");
    if (!hasTasks) { rec.textContent = "Add a task to see your savings."; rec.classList.add("warn"); }
    else if (best.id === "manual") { rec.innerHTML = "<b>Keep these tasks by hand for now.</b> With your numbers, none of the options saves time for less than it costs. Try the Detailed view to adjust review and redo time."; rec.classList.add("warn"); }
    else rec.innerHTML = recommendation(r, best);
    if (hasTasks && r.hourly === 0) { rec.innerHTML += " <b>Enter your pay</b> to see what the time is worth."; rec.classList.add("warn"); }

    $("#sum-scen").innerHTML = ["low", "typical", "high"].map((l) => {
      const x = best.result[l];
      return `<div class="${l === "typical" ? "on" : ""}">${C.SCENARIOS[l].label}<b>${hrs(x.savedH)} h</b>${money(x.net)} / Month</div>`;
    }).join("");

    renderBars(r, best, pick);
    renderTable(r, best, pick);
    renderTaskSection(r, pick, s);
    renderFormulas(r, pick, s);
    renderPrices(s);
    renderFoot(r, best);
    renderWitty(T, r);

    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      $("#live").textContent = hasTasks ? `Typical case: ${hrs(T.savedH)} hours saved a month, net benefit ${money(T.net)} a month, best value ${best.label}.` : "No tasks added.";
    }, 900);
  }

  function recommendation(r, best) {
    const T = best.result.typical;
    const paid = r.options.filter((o) => (o.kind === "one" || o.kind === "multi") && !o.priceMissing)
      .sort((a, b) => b.result.typical.net - a.result.typical.net)[0];
    let text = `<b>Best value: ${esc(cap(best.short))}${best.kind === "one" ? " on top of free tools" : ""}.</b> About ${hrs(T.savedH)} hours a month, worth ${money(T.value)}.`;
    if (best.toolCost === 0 && paid && paid.result.typical.savedH > T.savedH) {
      const extraH = paid.result.typical.savedH - T.savedH, gap = T.net - paid.result.typical.net;
      text += gap > 0
        ? ` ${esc(cap(paid.short))} would save ${hrs(extraH)} more hours, but costs ${money(gap)} a month more than that time is worth to you.`
        : ` ${esc(cap(paid.short))} saves a little more, but not enough to beat the free option by more than 5%.`;
    } else if (best.toolCost > 0) {
      const free = r.options.find((o) => o.id === "browser");
      if (free) text += ` That beats free tools by ${money(T.net - free.result.typical.net)} a month after paying ${money(best.toolCost)} for the plan.`;
      if (T.hoursToCover !== null) text += ` It pays for itself once it saves ${hrs(T.hoursToCover, 1)} hours a month.`;
    }
    if (best.limitedTools.length) text += " Free plans have usage limits, so only part of your runs are counted.";
    return text;
  }

  function renderBars(r, best, pick) {
    const rows = r.options;
    const vals = rows.map((o) => o.result.typical.net);
    const max = Math.max(1, ...vals.map(Math.abs));
    const hasNeg = vals.some((v) => v < 0), hasPos = vals.some((v) => v > 0);
    const zero = hasNeg && hasPos ? (Math.abs(Math.min(...vals)) / (Math.abs(Math.min(...vals)) + Math.max(...vals))) * 100 : hasNeg ? 100 : 0;
    const span = hasNeg && hasPos ? Math.abs(Math.min(...vals)) + Math.max(...vals) : max;
    $("#bars").innerHTML = rows.map((o) => {
      const v = o.result.typical.net;
      const w = (Math.abs(v) / span) * 100;
      const left = v >= 0 ? zero : zero - w;
      const cls = v < 0 ? "neg" : o.id === best.id ? "best" : "";
      return `<li><button type="button" data-pick="${esc(o.id)}" aria-pressed="${o.id === pick.id}">${esc(o.label)}${o.id === best.id ? ' <span class="tag">Best value</span>' : ""}</button>
        <span class="track" aria-hidden="true"><span class="zero" style="left:${zero}%"></span><i class="${cls}" style="left:${left}%;width:${w}%"></i></span>
        <span class="v ${v < 0 ? "neg-v" : v > 0 ? "pos-v" : ""}">${money(v)}</span></li>`;
    }).join("");
  }

  function renderTable(r, best, pick) {
    $("#cmp tbody").innerHTML = r.options.map((o) => {
      const L = o.result.low, T = o.result.typical, H = o.result.high;
      const notes = [];
      if (o.id === "manual") notes.push("The starting point: no AI.");
      if (o.kind === "browser") notes.push("Adds Sahkarmi's built-in browser for web tasks. Made by the team behind this calculator.");
      if (o.limitedTools.length) notes.push(`Free limits cap part of your runs (${esc(state.limitShare)}% counted): ${esc(o.limitedTools.join(", "))}.`);
      if (o.uncovered.length && o.id !== "manual") notes.push(`Not counted for: ${esc(o.uncovered.join(", "))}.`);
      if (o.plan && C.TOOLS.find((t) => t.id === o.plan).from) notes.push("Lowest tier price; higher tiers cost more.");
      if (state.owned.length && o.id !== "manual") notes.push("Plans you already pay for are included at no extra cost.");
      const be = o.id === "manual" ? "—" : T.net <= 0 ? "Does not" : T.breakEvenMonths === 0 ? "Right away" : T.breakEvenMonths < 1 ? "Within a month" : `${plain(T.breakEvenMonths, 1)} months`;
      const roi = T.roi === null ? (o.id === "manual" ? "—" : "No plan cost") : pct(T.roi);
      return `<tr class="${o.id === best.id ? "best" : ""} ${o.id === pick.id ? "pick" : ""}">
        <td>${esc(o.label)}${o.id === best.id ? '<br><span class="tag">Best value</span>' : ""}${notes.length ? `<span class="note">${notes.join(" ")}</span>` : ""}</td>
        <td class="num" data-label="New cost / Month">${o.priceMissing ? "Price not available" : money(o.toolCost)}</td>
        <td class="num" data-label="Hours saved / Month">${hrs(T.savedH)}<span class="note">${hrs(L.savedH)} to ${hrs(H.savedH)}</span></td>
        <td class="num" data-label="Value / Month">${money(T.value)}</td>
        <td class="num ${T.net < 0 ? "neg-v" : T.net > 0 ? "pos-v" : ""}" data-label="Net / Month"><b>${money(T.net)}</b><span class="note">${money(L.net)} to ${money(H.net)}</span></td>
        <td class="num" data-label="First year">${money(T.firstYear)}<span class="note">after setup ${money(T.setupCost)}</span></td>
        <td class="num" data-label="Pays back">${be}</td>
        <td class="num" data-label="Return, year one">${roi}</td></tr>`;
    }).join("");
  }

  function suitability(task, row) {
    if (task.method === "none" || task.fit === "manual") return ['manual', "Not reliable to automate"];
    if (row.share === 0) return ["manual", "Not covered by these tools"];
    if (row.slower) return ["manual", "AI not faster here"];
    const base = task.fit === "good" ? ["good", "Automatable, spot-check"] : ["review", "AI drafts, needs review"];
    if (row.share < 1) base[1] += ` · ${plain(row.share * 100)}% of runs (free limits)`;
    return base;
  }

  function renderTaskSection(r, pick, s) {
    fillSelect($("#pick"), r.options.map((o) => [o.id, o.label]), pick.id);
    $("#task-sub").textContent = `Typical case with: ${pick.label}.`;
    const T = pick.result.typical;
    const max = Math.max(0.01, ...T.rows.map((x) => x.manualH));
    const byId = Object.fromEntries(r.tasks.map((t) => [t.id, t]));
    if (!T.rows.length) {
      $("#tbars").innerHTML = `<li class="empty" style="display:block">No tasks yet.</li>`;
      $("#ttable tbody").innerHTML = `<tr><td colspan="6" class="muted">No records found.</td></tr>`;
      return;
    }
    $("#tbars").innerHTML = T.rows.map((x) => {
      const t = byId[x.id];
      return `<li><span>${esc(t.name)}</span><span class="pair">
        <span class="row"><span class="track"><i class="man" style="width:${(x.manualH / max) * 100}%"></i></span><span>${hrs(x.manualH)} h</span></span>
        <span class="row"><span class="track"><i class="ai" style="width:${(x.autoH / max) * 100}%"></i></span><span>${hrs(x.autoH)} h</span></span></span></li>`;
    }).join("");
    $("#ttable tbody").innerHTML = T.rows.map((x) => {
      const t = byId[x.id];
      const [cls, label] = suitability(t, x);
      return `<tr><td>${esc(t.name)}</td><td class="num" data-label="Runs / Month">${plain(x.runs, 1)}</td><td class="num" data-label="By hand">${hrs(x.manualH)} h</td>
        <td class="num" data-label="With AI">${hrs(x.autoH)} h</td><td class="num" data-label="Saved"><b>${hrs(x.savedH)} h</b></td>
        <td class="wide" data-label="Suitability"><span class="pill ${cls}">${esc(label)}</span></td></tr>`;
    }).join("") + `<tr><td><b>Total</b></td><td class="num" data-label="Runs / Month"></td><td class="num" data-label="By hand"><b>${hrs(T.manualH)} h</b></td><td class="num" data-label="With AI"><b>${hrs(T.autoH)} h</b></td><td class="num" data-label="Saved"><b>${hrs(T.savedH)} h</b></td><td class="wide" data-label="Cost by hand">By hand costs ${money(T.manualCost)} of your time a month</td></tr>`;
  }

  function renderFoot(r, best) {
    const T = best.result.typical;
    const byId = Object.fromEntries(T.rows.map((x) => [x.id, x]));
    for (const li of document.querySelectorAll("#tasks .task")) {
      const t = r.tasks.find((x) => x.id === li.dataset.id), x = byId[li.dataset.id];
      if (!t || !x) continue;
      const [cls, label] = suitability(t, x);
      li.querySelector("[data-foot]").innerHTML = `<span class="pill ${cls}">${esc(label)}</span><span>${plain(x.runs, 1)} runs a month · saves <b>${hrs(x.savedH)} h</b> a month (typical, with ${esc(best.short)})</span>`;
    }
  }

  function renderFormulas(r, pick, s) {
    const sch = r.schedule, T = pick.result.typical, c = state.currency;
    const first = r.tasks[0], row = first && T.rows.find((x) => x.id === first.id);
    const hourlyLine = s.payMode === "hourly"
      ? `Value of one hour = ${money(r.hourly, state.currency, 2)} (entered by you)`
      : `Hourly value = monthly pay × 12 ÷ (hours a day × days a week × weeks a year) = ${money(s.monthlyPay)} × 12 ÷ (${plain(sch.hoursPerDay, 1)} × ${plain(sch.daysPerWeek)} × ${plain(sch.weeksPerYear)}) = ${money(r.hourly, state.currency, 2)}`;
    const items = [["Value of your time", hourlyLine]];
    if (first && row) {
      const runsLine = first.per === "day" ? `${plain(first.freq, 2)} a day × ${plain(sch.daysPerWeek)} days × ${plain(sch.weeksPerYear)} weeks ÷ 12`
        : first.per === "week" ? `${plain(first.freq, 2)} a week × ${plain(sch.weeksPerYear)} weeks ÷ 12` : `${plain(first.freq, 2)} a month`;
      items.push([`Runs a month (${first.name})`, `${runsLine} = ${plain(row.runs, 1)}`]);
      items.push(["Hours by hand", `runs × minutes by hand ÷ 60 = ${plain(row.runs, 1)} × ${plain(first.manualMin, 1)} ÷ 60 = ${hrs(row.manualH)} h`]);
      if (row.share > 0 && !row.slower) {
        items.push(["Minutes per run with AI", `AI minutes + review minutes + redo share × minutes by hand = ${plain(first.aiMin, 1)} + ${plain(first.reviewMin, 1)} + ${plain(first.redoPct)}% × ${plain(first.manualMin, 1)} = ${plain(row.aiRunMin, 2)} min`]);
        items.push(["Hours with AI", `runs × (share AI can take × minutes with AI + rest × minutes by hand) ÷ 60 = ${plain(row.runs, 1)} × (${plain(row.share * 100)}% × ${plain(row.aiRunMin, 2)} + ${plain((1 - row.share) * 100)}% × ${plain(first.manualMin, 1)}) ÷ 60 = ${hrs(row.autoH)} h`]);
      } else items.push(["Hours with AI", `No saving counted for this task with this option, so it stays at ${hrs(row.autoH)} h`]);
    }
    items.push(["Hours saved a month (all tasks)", `hours by hand − hours with AI = ${hrs(T.manualH)} − ${hrs(T.autoH)} = ${hrs(T.savedH)} h`]);
    items.push(["Value of the time saved", `hours saved × hourly value = ${hrs(T.savedH, 2)} × ${money(r.hourly, state.currency, 2)} = ${money(T.value)} a month`]);
    items.push(["New plan cost", pick.toolCost ? `${money(pick.toolCost)} a month in ${c}${state.addGst ? ", including 18% GST on US dollar plans" : ""}${Number(s.cardMarkupPct) ? ` and a ${plain(s.cardMarkupPct, 1)}% card fee` : ""}` : `${money(0)}: no new plan`]);
    items.push(["Net benefit", `value − plan cost = ${money(T.value)} − ${money(pick.toolCost || 0)} = ${money(T.net)} a month`]);
    items.push(["First year", `net benefit × 12 − setup time (${hrs(T.setupH, 1)} h × ${money(r.hourly)}) = ${money(T.firstYear)}`]);
    items.push(["Return in year one", T.roi === null ? "No plan to pay for, so there is no return on money spent" : `(value × 12 − year cost) ÷ year cost, where year cost = plan × 12 + setup = (${money(T.value * 12)} − ${money(pick.toolCost * 12 + T.setupCost)}) ÷ ${money(pick.toolCost * 12 + T.setupCost)} = ${pct(T.roi)}`]);
    if (state.savedTimeUse === "cash") items.push(["Cash saving", `saved hours replace paid work: ${money(T.cash)} − plan cost ${money(pick.toolCost || 0)} = ${money(T.cashNet)} a month`]);
    else items.push(["Cash saving", `${money(0)} in cash: the time is productivity value. The plan cost, ${money(pick.toolCost || 0)} a month, is real money`]);
    $("#formulas").innerHTML = items.map(([h, f]) => `<li>${esc(h)}<code>${esc(f)}</code></li>`).join("");
  }

  function renderPrices(s) {
    $("#price-sub").textContent = `Checked on ${dateText(C.PRICES_CHECKED)} from India. Rupee prices are as listed on each vendor's India page.`;
    $("#trust-prices").textContent = `Plan prices checked on ${dateText(C.PRICES_CHECKED)}. Exchange rates from ${dateText(fx.date)}.`;
    const what = { chat: "Chat", browser: "Browser", code: "Code" };
    $("#prices tbody").innerHTML = C.TOOLS.map((t) => {
      const cost = C.planCost(t, s, fx);
      return `<tr><td><a href="${esc(t.source)}" target="_blank" rel="noopener noreferrer">${esc(t.name)}</a><span class="note">${esc(t.vendor)}</span></td>
        <td class="num" data-label="Listed price">${esc(listed(t))}${t.from ? '<span class="note">lowest tier</span>' : ""}</td>
        <td class="num" data-label="Your cost / Month">${t.monthly ? money(cost) : "Free"}</td>
        <td class="methods" data-label="Counted for">${t.methods.map((m) => what[m]).join(", ")}${t.limited ? '<span class="note">usage limits</span>' : ""}</td>
        <td class="wide" data-label="Notes"><span class="note" style="margin:0">${esc(t.note)}${t.monthly ? ` ${esc(C.TAX_NOTES[t.vendor] || "")}` : ""}</span></td></tr>`;
    }).join("");
    $("#fx-state").textContent = `Exchange rates from ${dateText(fx.date)}: 1 US dollar = ${C.CURRENCIES.INR.symbol}${plain(fx.rates.INR, 2)}.`;
  }

  function renderWitty(T, r) {
    const el = $("#witty");
    if (!r.tasks.length) { el.hidden = true; return; }
    const days = T.perYear / r.schedule.hoursPerDay;
    const key = T.perYear <= 0.05 ? "none" : days >= 10 ? "big" : days >= 2 ? "medium" : "small";
    el.innerHTML = WITTY[key].replace("{days}", plain(days)).replace("{hours}", hrs(T.perYear, 0));
    el.hidden = false;
  }

  // ---------- events ----------
  let saveTimer;
  function changed(rerenderTasks) {
    if (rerenderTasks) renderTasks();
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { tasks, ...rest } = state;
      const ok = write(STORE, { ...rest, tasks: tasks.map(({ id, ...t }) => t) });
      $("#save-state").textContent = ok ? "Saved in this browser only." : "Your browser is not allowing saving, so this resets when you leave.";
    }, 400);
  }

  function setCurrency(next) {
    const prev = state.currency;
    if (next === prev || !C.CURRENCIES[next]) return;
    for (const k of ["monthlyPay", "hourlyRate"]) {
      const v = Number(state[k]);
      if (Number.isFinite(v) && v > 0) {
        const conv = C.convert(v, prev, next, fx);
        const step = conv >= 10000 ? 100 : conv >= 100 ? 1 : 0.01;
        state[k] = Math.round(conv / step) * step;
      }
    }
    state.currency = next;
    syncForm();
    toast(`Pay converted to ${C.CURRENCIES[next].label} at the ${dateText(fx.date)} rate.`);
  }

  function toast(text, undo) {
    $("#toast-text").textContent = text;
    $("#toast-undo").hidden = !undo;
    $("#toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("#toast").classList.remove("show"); lastRemoved = null; }, undo ? 8000 : 3500);
  }

  function bind() {
    const form = $("#calc");
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("input", (e) => {
      const el = e.target;
      if (el.dataset.k && el.type !== "radio" && el.type !== "checkbox" && el.tagName !== "SELECT") {
        state[el.dataset.k] = el.value;
        showError(el, $(`#e-${el.dataset.k}`), check(el.dataset.k, el.value).error);
        changed();
      } else if (el.dataset.f && el.tagName !== "SELECT") {
        const li = el.closest(".task"), t = state.tasks.find((x) => x.id === li.dataset.id);
        t[el.dataset.f] = el.value;
        state.tasksTouched = true;
        validateTask(t, li);
        if (el.dataset.f === "name") li.querySelector("[data-remove]").setAttribute("aria-label", `Remove task: ${el.value.trim() || "unnamed"}`);
        changed();
      }
    });
    form.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.list) {
        const list = new Set(state[el.dataset.list]);
        el.checked ? list.add(el.value) : list.delete(el.value);
        state[el.dataset.list] = [...list];
        if (el.dataset.list === "owned") syncForm();
        changed();
      } else if (el.dataset.k === "currency") { setCurrency(el.value); changed(); }
      else if (el.dataset.k === "profession") {
        state.profession = el.value;
        if (!state.tasksTouched) state.tasks = C.PROFESSIONS[el.value].tasks.map(makeTask);
        changed(true);
      } else if (el.dataset.k) {
        state[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
        syncForm();
        changed();
      } else if (el.dataset.f && el.tagName === "SELECT") {
        const t = state.tasks.find((x) => x.id === el.closest(".task").dataset.id);
        t[el.dataset.f] = el.value;
        if (el.dataset.f === "method" && el.value === "none") t.fit = "manual";
        if (el.dataset.f === "fit" && el.value !== "manual" && t.method === "none") t.method = "chat";
        el.closest(".task").querySelector('[data-f="fit"]').value = t.fit;
        el.closest(".task").querySelector('[data-f="method"]').value = t.method;
        state.tasksTouched = true;
        changed();
      }
    });
    form.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      const rm = e.target.closest("[data-remove]");
      if (add) {
        state.tasks.push(makeTask(add.dataset.add));
        state.tasksTouched = true;
        changed(true);
        const last = $("#tasks .task:last-child input[data-f='freq']");
        if (last) last.focus();
      } else if (rm) {
        const li = rm.closest(".task"), i = state.tasks.findIndex((x) => x.id === li.dataset.id);
        const [t] = state.tasks.splice(i, 1);
        lastRemoved = { t, i };
        state.tasksTouched = true;
        changed(true);
        toast(`Removed ${String(t.name).trim() || "the task"}.`, true);
        const next = $("#tasks .task:nth-child(" + Math.min(i + 1, state.tasks.length) + ") [data-remove]") || $("#add-task");
        next.focus();
      }
    });
    $("#add-task").addEventListener("click", () => {
      state.tasks.push(makeTask("custom"));
      state.tasksTouched = true;
      changed(true);
      $("#tasks .task:last-child input[data-f='name']").focus();
    });
    $("#toast-undo").addEventListener("click", () => {
      if (!lastRemoved) return;
      state.tasks.splice(lastRemoved.i, 0, lastRemoved.t);
      lastRemoved = null;
      $("#toast").classList.remove("show");
      changed(true);
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (b) { pickId = b.dataset.pick; render(); document.getElementById("task-title").scrollIntoView({ block: "start" }); }
    });
    $("#pick").addEventListener("change", (e) => { pickId = e.target.value; render(); });

    const dlg = $("#confirm");
    $("#clear").addEventListener("click", () => (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "")));
    $("#confirm-cancel").addEventListener("click", () => dlg.close());
    $("#confirm-ok").addEventListener("click", () => {
      remove(STORE);
      state = defaults();
      pickId = null;
      dlg.close();
      syncForm();
      renderTasks();
      render();
      $("#save-state").textContent = "Saved data cleared. Starting numbers are back.";
      toast("Your saved calculator data was cleared.");
    });

    $("#fx-refresh").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      $("#fx-state").textContent = "Getting today's rates…";
      try {
        const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR,EUR,GBP,SGD,AUD,CAD");
        const j = await res.json();
        if (!res.ok || !j.rates || !j.rates.INR) throw new Error("bad response");
        fx = { date: j.date, source: C.FX.source, rates: { ...C.FX.rates, ...j.rates, USD: 1, AED: 3.6725 } };
        write(FX_STORE, fx);
        render();
        toast(`Exchange rates updated to ${dateText(fx.date)}.`);
      } catch {
        render();
        $("#fx-state").textContent = `Could not reach the rate service. Using rates from ${dateText(fx.date)}.`;
      } finally { btn.disabled = false; }
    });
  }

  function validFx(j) {
    return j && typeof j.date === "string" && j.rates && Object.keys(C.CURRENCIES).every((k) => Number(j.rates[k]) > 0);
  }

  // ---------- start ----------
  function start() {
    state = load();
    const cachedFx = read(FX_STORE);
    if (validFx(cachedFx) && cachedFx.date > fx.date) fx = cachedFx;
    fillSelect($("#currency"), Object.entries(C.CURRENCIES).map(([k, c]) => [k, c.label]), state.currency);
    fillSelect($("#profession"), Object.entries(C.PROFESSIONS).map(([k, p]) => [k, p.label]), state.profession);
    planChoices($("#owned"), "owned");
    planChoices($("#compare"), "compare");
    syncForm();
    renderTasks();
    render();
    bind();
    // Mobile: a small bar with the result, hidden while the result card itself is on screen.
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => $("#mini").classList.toggle("off", e.isIntersecting)).observe($("#sum-card"));
    // Rates baked in at the last deploy; newer than the built-in copy whenever the site was redeployed.
    fetch("/assets/fx.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (validFx(j) && j.date > fx.date) { fx = { ...j, rates: { ...C.FX.rates, ...j.rates } }; render(); }
    }).catch(() => { /* keep the built-in rates */ });
  }
  start();
})();
