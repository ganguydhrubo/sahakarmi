/* Sahkarmi AI time and money savings calculator: data and maths.
   Runs entirely in the visitor's browser. Nothing here is sent anywhere.
   Also loaded by scripts/test-savings.mjs, so keep it free of DOM code. */
(function (root) {
  "use strict";

  // Prices checked on the official pricing pages from India on 29/10/2026.
  const PRICES_CHECKED = "2026-10-29";
  const GST_RATE = 0.18; // India GST on imported digital services (plans priced in US dollars)

  // methods: work the plan helps with when you ask it each time. chat = writing, research, files;
  //   browser = acting on web pages; code = coding.
  // auto: work it can run by itself on a schedule while you only check the results.
  // Only capabilities listed on the vendor's own pricing page (or Sahkarmi's guide) are counted.
  // limited: a free plan with usage limits the vendor does not publish as fixed numbers (see limitShare).
  const TOOLS = [
    { id: "sahkarmi", name: "Sahkarmi (free app)", vendor: "Sahkarmi, made by the team behind this calculator", cur: "INR", monthly: 0,
      methods: ["chat", "browser", "code"], auto: ["chat", "browser", "code"], limited: true, source: "https://sahkarmi.site/docs.html",
      note: "Free Windows app. AI coworkers with a built-in browser that run work on a schedule (hourly, daily, weekdays or weekly) or as routines. Uses free OpenCode models (OpenCode sets their limits) or your own ChatGPT, Claude or Google Antigravity sign-in. Development preview: approvals depend on the AI model following its instructions." },
    { id: "chatgpt-free", name: "ChatGPT Free", vendor: "OpenAI", cur: "INR", monthly: 0, methods: ["chat", "code"], limited: true,
      source: "https://chatgpt.com/pricing", note: "Limited uploads, data analysis, deep research and Codex. No scheduled tasks. Counted for chat and coding only." },
    { id: "chatgpt-go", name: "ChatGPT Go", vendor: "OpenAI", cur: "INR", monthly: 399, methods: ["chat"], auto: ["chat"],
      source: "https://chatgpt.com/pricing", note: "More messages, uploads and image creation than Free, and scheduled tasks. Deep research still limited. May show ads. Counted for chat only." },
    { id: "chatgpt-plus", name: "ChatGPT Plus", vendor: "OpenAI", cur: "INR", monthly: 1999, methods: ["chat", "browser", "code"], auto: ["chat"],
      source: "https://chatgpt.com/pricing", note: "Expanded deep research, Codex and ChatGPT Work, scheduled tasks and projects. Usage limits apply." },
    { id: "chatgpt-pro", name: "ChatGPT Pro", vendor: "OpenAI", cur: "INR", monthly: 10699, from: true, methods: ["chat", "browser", "code"], auto: ["chat"],
      source: "https://chatgpt.com/pricing", note: "Lowest of three Pro usage tiers. Longer Codex and ChatGPT Work sessions, scheduled tasks." },
    { id: "claude-free", name: "Claude Free", vendor: "Anthropic", cur: "USD", monthly: 0, methods: ["chat"], limited: true,
      source: "https://claude.com/pricing", note: "Chat, web search, files and code execution. No Claude Code and no Claude in Chrome." },
    { id: "claude-pro", name: "Claude Pro", vendor: "Anthropic", cur: "USD", monthly: 20, annualMonthly: 17, methods: ["chat", "browser", "code"],
      source: "https://claude.com/pricing", note: "Includes Claude Code and Claude in Chrome. Usage limits reset every five hours, with weekly limits as well. Annual plan: $200 billed up front." },
    { id: "claude-max", name: "Claude Max", vendor: "Anthropic", cur: "USD", monthly: 100, from: true, methods: ["chat", "browser", "code"],
      source: "https://claude.com/pricing", note: "Lowest Max tier: five times the usage of Pro. A 20 times tier costs more." },
    { id: "google-ai-plus", name: "Google AI Plus", vendor: "Google", cur: "INR", monthly: 399, methods: ["chat"],
      source: "https://one.google.com/about/google-ai-plans/", note: "Gemini app with Deep Research and 400 GB storage. Counted for chat only." },
    { id: "google-ai-pro", name: "Google AI Pro", vendor: "Google", cur: "INR", monthly: 1950, methods: ["chat", "browser", "code"],
      source: "https://one.google.com/about/google-ai-plans/", note: "Chrome auto browse (US and India), expanded Google Antigravity access and 5 TB storage." },
    { id: "google-ai-ultra", name: "Google AI Ultra", vendor: "Google", cur: "INR", monthly: 6500, from: true, methods: ["chat", "browser", "code"],
      source: "https://one.google.com/about/google-ai-plans/", note: "Starting price. Higher limits for Chrome auto browse and Antigravity." },
    { id: "antigravity-free", name: "Google Antigravity (individual)", vendor: "Google", cur: "USD", monthly: 0, methods: ["code"], limited: true,
      source: "https://antigravity.google/pricing", note: "Agent-based coding app. Basic weekly rate limits without a Google AI plan." },
    { id: "copilot-free", name: "GitHub Copilot Free", vendor: "GitHub", cur: "USD", monthly: 0, methods: ["code"], limited: true,
      source: "https://github.com/features/copilot/plans", note: "2,000 code completions a month." },
    { id: "copilot-pro", name: "GitHub Copilot Pro", vendor: "GitHub", cur: "USD", monthly: 10, methods: ["code"],
      source: "https://github.com/features/copilot/plans", note: "Unlimited completions, coding agent and code review. For code only." },
    { id: "copilot-pro-plus", name: "GitHub Copilot Pro+", vendor: "GitHub", cur: "USD", monthly: 39, methods: ["code"],
      source: "https://github.com/features/copilot/plans", note: "Premium models and more usage than Pro. For code only." },
  ];
  const FREE_TOOLS = ["chatgpt-free", "claude-free", "antigravity-free", "copilot-free"];
  // Paid plans Sahkarmi can run on through your own sign-in (Claude Code, Codex, Google Antigravity), per its guide.
  // With one of them, Sahkarmi is no longer held back by the free models' limits.
  const SAHKARMI_ENGINES = ["claude-pro", "claude-max", "chatgpt-plus", "chatgpt-pro", "google-ai-pro", "google-ai-ultra"];
  const TAX_NOTES = {
    OpenAI: "Rupee price from OpenAI's India page, which does not say whether GST is included.",
    Google: "Rupee price from Google's India page, which does not say whether GST is included.",
    Anthropic: "US dollar price. Anthropic says its prices exclude tax.",
    GitHub: "US dollar price. GitHub's page does not mention tax.",
  };

  // Exchange rates per 1 US dollar: ECB reference rates (via Frankfurter) on 28/10/2026.
  // AED uses the UAE dirham's fixed peg. /assets/fx.json, refreshed at each deploy, replaces these when newer.
  const FX = {
    date: "2026-10-28",
    source: "European Central Bank reference rates, via Frankfurter",
    rates: { USD: 1, INR: 95.22, EUR: 0.89823, GBP: 0.75258, SGD: 1.2821, AUD: 1.4219, CAD: 1.4047, AED: 3.6725 },
  };
  const CURRENCIES = {
    INR: { label: "Indian rupee (₹)", symbol: "₹", locale: "en-IN" }, USD: { label: "US dollar ($)", symbol: "$", locale: "en-US" },
    EUR: { label: "Euro (€)", symbol: "€", locale: "en-IE" }, GBP: { label: "British pound (£)", symbol: "£", locale: "en-GB" },
    AED: { label: "UAE dirham (AED)", symbol: "AED ", locale: "en-AE" }, SGD: { label: "Singapore dollar (S$)", symbol: "S$", locale: "en-SG" },
    AUD: { label: "Australian dollar (A$)", symbol: "A$", locale: "en-AU" }, CAD: { label: "Canadian dollar (C$)", symbol: "C$", locale: "en-CA" },
  };

  const METHODS = {
    chat: "Writing, research or files",
    browser: "Work on websites",
    code: "Coding",
    none: "Keep doing it by hand",
  };
  const MODES = {
    auto: "Runs by itself; you check the results",
    assist: "You ask an AI each time",
  };
  const FITS = {
    good: "Good fit: spot-check the results",
    review: "AI drafts, you review every time",
    manual: "Not reliable to automate",
  };

  // Starting assumptions per task type. Minutes are per run. Every one of them can be changed on the page.
  // "Ask each time" figures follow published studies: writing about 40% faster (Noy and Zhang, Science 2023),
  // coding about 56% faster (Peng et al. 2023), support 14% more work done (Brynjolfsson et al. 2023).
  // "Runs by itself" figures are our estimates for well set-up scheduled agents; the cautious case is shown too.
  const TASK_TYPES = {
    email: { label: "Email drafting and replies", method: "chat", mode: "assist", fit: "review", freq: 10, per: "day", manualMin: 8, aiMin: 2, reviewMin: 2, redoPct: 10, setupHours: 0.5 },
    followups: { label: "Follow-ups and reminders", method: "chat", mode: "auto", fit: "good", freq: 5, per: "day", manualMin: 5, aiMin: 2, reviewMin: 0.5, redoPct: 5, setupHours: 1 },
    report: { label: "Recurring reports", method: "chat", mode: "auto", fit: "review", freq: 2, per: "week", manualMin: 60, aiMin: 10, reviewMin: 8, redoPct: 10, setupHours: 2 },
    spreadsheet: { label: "Spreadsheet updates and processing", method: "chat", mode: "auto", fit: "good", freq: 1, per: "day", manualMin: 30, aiMin: 5, reviewMin: 3, redoPct: 10, setupHours: 2 },
    dataentry: { label: "Data entry on websites", method: "browser", mode: "auto", fit: "review", freq: 3, per: "day", manualMin: 20, aiMin: 6, reviewMin: 2, redoPct: 10, setupHours: 2 },
    admin: { label: "Repetitive admin on websites", method: "browser", mode: "auto", fit: "good", freq: 5, per: "week", manualMin: 15, aiMin: 5, reviewMin: 1.5, redoPct: 10, setupHours: 1.5 },
    research: { label: "Research and summaries", method: "chat", mode: "assist", fit: "review", freq: 3, per: "week", manualMin: 45, aiMin: 12, reviewMin: 10, redoPct: 10, setupHours: 0.5 },
    document: { label: "Document preparation", method: "chat", mode: "assist", fit: "review", freq: 3, per: "week", manualMin: 40, aiMin: 8, reviewMin: 8, redoPct: 10, setupHours: 1 },
    social: { label: "Social media posts", method: "chat", mode: "assist", fit: "review", freq: 3, per: "week", manualMin: 30, aiMin: 5, reviewMin: 6, redoPct: 10, setupHours: 0.5 },
    support: { label: "Customer replies and support", method: "chat", mode: "assist", fit: "review", freq: 8, per: "day", manualMin: 10, aiMin: 3, reviewMin: 4, redoPct: 10, setupHours: 1 },
    code: { label: "Coding and scripts", method: "code", mode: "assist", fit: "review", freq: 3, per: "week", manualMin: 60, aiMin: 12, reviewMin: 10, redoPct: 10, setupHours: 1 },
    meetings: { label: "Meetings, calls and decisions", method: "none", mode: "assist", fit: "manual", freq: 1, per: "day", manualMin: 45, aiMin: 45, reviewMin: 0, redoPct: 0, setupHours: 0 },
    custom: { label: "Other task", method: "chat", mode: "assist", fit: "review", freq: 1, per: "day", manualMin: 20, aiMin: 6, reviewMin: 5, redoPct: 10, setupHours: 1 },
  };

  const PROFESSIONS = {
    general: { label: "General office work", tasks: ["email", "spreadsheet", "report"] },
    founder: { label: "Business owner or founder", tasks: ["email", "followups", "report", "research"] },
    accounts: { label: "Accounts and finance", tasks: ["spreadsheet", "dataentry", "followups", "report"] },
    sales: { label: "Sales", tasks: ["followups", "email", "dataentry", "report"] },
    hr: { label: "HR and administration", tasks: ["document", "dataentry", "admin", "email"] },
    marketing: { label: "Marketing and content", tasks: ["social", "research", "report"] },
    support: { label: "Customer support", tasks: ["support", "followups", "dataentry"] },
    developer: { label: "Software developer", tasks: ["code", "document", "research"] },
    consultant: { label: "Consultant or analyst", tasks: ["research", "report", "spreadsheet"] },
    teacher: { label: "Teacher or trainer", tasks: ["document", "report", "email"] },
  };

  // Cautious / typical / best case: human minutes and the share of runs redone by hand are scaled by these.
  const SCENARIOS = {
    low: { label: "Cautious", time: 1.5, redo: 1.5 },
    typical: { label: "Typical", time: 1, redo: 1 },
    high: { label: "Best case", time: 0.75, redo: 0.5 },
  };

  const DEFAULTS = {
    profession: "general", currency: "INR", people: 1, payMode: "monthly", monthlyPay: 50000, overheadPct: 25, hourlyRate: 400,
    hoursPerDay: 8, daysPerWeek: 5, holidays: 10, leaveDays: 15, sickDays: 6, learnHours: 2,
    billing: "monthly", addGst: true, cardMarkupPct: 0, limitShare: 50, useSahkarmi: true, savedTimeUse: "productive",
    owned: [], compare: ["chatgpt-plus", "claude-pro", "google-ai-pro"],
  };

  const num = (v, fallback = 0) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Tasks happen on every business day, whoever does them. The person is paid for business days, holidays,
  // leave and sick days alike, but works only on the days they are in, so each worked hour costs more.
  function schedule(s) {
    const hoursPerDay = clamp(num(s.hoursPerDay, 8), 1, 24);
    const daysPerWeek = clamp(num(s.daysPerWeek, 5), 1, 7);
    const holidays = clamp(num(s.holidays, 10), 0, 60);
    const businessDays = Math.max(1, daysPerWeek * 52 - holidays);
    const awayDays = clamp(num(s.leaveDays, 15) + num(s.sickDays, 6), 0, businessDays - 1);
    const workDays = businessDays - awayDays;
    const hoursPerYear = workDays * hoursPerDay;
    return { hoursPerDay, daysPerWeek, holidays, businessDays, awayDays, workDays, hoursPerYear, hoursPerMonth: hoursPerYear / 12,
      daysPerMonth: businessDays / 12, weeksPerMonth: businessDays / daysPerWeek / 12, awayShare: awayDays / businessDays };
  }

  // All-in cost of one worked hour: salary plus office, equipment, software and management costs.
  function hourlyValue(s, sch) {
    if (s.payMode === "hourly") return Math.max(0, num(s.hourlyRate));
    const overhead = clamp(num(s.overheadPct, 25), 0, 200) / 100;
    return (Math.max(0, num(s.monthlyPay)) * 12 * (1 + overhead)) / sch.hoursPerYear;
  }

  function fxRate(fx, cur) { return (fx && fx.rates && fx.rates[cur]) || FX.rates[cur] || null; }
  function convert(amount, from, to, fx) {
    const a = fxRate(fx, from), b = fxRate(fx, to);
    return a && b ? (amount / a) * b : null;
  }

  // Monthly cost of one plan for one person in the visitor's currency, with optional GST and card currency markup.
  function planCost(tool, s, fx) {
    if (!tool || !tool.monthly) return 0;
    const base = s.billing === "annual" && tool.annualMonthly ? tool.annualMonthly : tool.monthly;
    let cost = convert(base, tool.cur, s.currency, fx);
    if (cost === null) return null;
    if (s.addGst && tool.cur === "USD") cost *= 1 + GST_RATE;
    if (tool.cur !== s.currency) cost *= 1 + clamp(num(s.cardMarkupPct), 0, 20) / 100;
    return cost;
  }

  // Runs a month for one person. Daily and weekly tasks happen on business days.
  function runsPerMonth(task, sch) {
    const f = Math.max(0, num(task.freq));
    return task.per === "day" ? f * sch.daysPerMonth : task.per === "week" ? f * sch.weeksPerMonth : f;
  }

  // What a set of tools can do for one kind of work. Returns the share of runs it takes on (1, the free-plan
  // share, or 0) and whether it runs them by itself. A task set to run by itself falls back to
  // "ask each time" when no tool in the set can schedule that kind of work.
  function capability(method, mode, tools, limitShare) {
    const engine = tools.some((t) => SAHKARMI_ENGINES.includes(t.id));
    const limited = (t) => t.limited && !(t.id === "sahkarmi" && engine);
    const share = (fit) => (fit.some((t) => !limited(t)) ? 1 : clamp(num(limitShare, 50), 0, 100) / 100);
    if (mode === "auto") {
      const fit = tools.filter((t) => (t.auto || []).includes(method));
      if (fit.length) return { share: share(fit), auto: true };
    }
    const fit = tools.filter((t) => t.methods.includes(method));
    return fit.length ? { share: share(fit), auto: false } : { share: 0, auto: false };
  }

  // One task, for one person, under one scenario.
  function taskResult(task, sch, factors, tools, limitShare) {
    const runs = runsPerMonth(task, sch);
    const manualMin = Math.max(0, num(task.manualMin));
    const manualH = (runs * manualMin) / 60;
    const cap = task.method === "none" || task.fit === "manual" ? { share: 0, auto: false } : capability(task.method, task.mode, tools, limitShare);
    let aiRunMin = manualMin, slower = false;
    if (cap.share > 0) {
      const redo = clamp((num(task.redoPct) * factors.redo) / 100, 0, 1);
      // When the task runs by itself, the AI's own working time is not your time; only checking and redoing are.
      const yourAiMin = cap.auto ? 0 : Math.max(0, num(task.aiMin));
      aiRunMin = (yourAiMin + Math.max(0, num(task.reviewMin))) * factors.time + redo * manualMin;
      if (aiRunMin >= manualMin) { slower = manualMin > 0; aiRunMin = manualMin; } // you would keep doing it by hand
    }
    const autoH = (runs * (cap.share * aiRunMin + (1 - cap.share) * manualMin)) / 60;
    const savedH = manualH - autoH;
    const setupH = savedH > 0 ? Math.max(0, num(task.setupHours)) : 0;
    return { runs, manualH, autoH, savedH, setupH, share: cap.share, auto: cap.auto && cap.share > 0 && !slower, slower, aiRunMin };
  }

  function summarise(tasks, sch, hourly, perPersonCost, s, level, tools) {
    const factors = SCENARIOS[level];
    const people = Math.round(clamp(num(s.people, 1), 1, 100000));
    const rows = tasks.map((t) => ({ id: t.id, ...taskResult(t, sch, factors, tools, s.limitShare) }));
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0) * people;
    const manualH = sum("manualH"), autoH = sum("autoH"), savedH = sum("savedH");
    // Setting up each task is done once for the team; learning the tools once per person.
    const setupH = rows.reduce((a, r) => a + r.setupH, 0) + (savedH > 0 ? Math.max(0, num(s.learnHours, 2)) * people : 0);
    const toolCost = perPersonCost * people;
    const value = savedH * hourly, manualCost = manualH * hourly, setupCost = setupH * hourly;
    const net = value - toolCost;
    const yearCost = toolCost * 12 + setupCost;
    const cash = s.savedTimeUse === "cash" ? value : 0;
    // Hours of this work that fall on days the person is on leave, ill or otherwise away, which someone
    // else has to cover today; and how many of those a scheduled agent would simply keep running.
    const awayH = manualH * sch.awayShare;
    const keepsRunningH = rows.filter((r) => r.auto).reduce((a, r) => a + r.manualH * r.share, 0) * people * sch.awayShare;
    return {
      level, people, rows, manualH, autoH, savedH, setupH, value, manualCost, setupCost, toolCost, net,
      pct: manualH > 0 ? savedH / manualH : 0,
      peopleEquiv: savedH / sch.hoursPerMonth,
      perDay: savedH / sch.daysPerMonth, perWeek: savedH / sch.weeksPerMonth, perYear: savedH * 12,
      valueYear: value * 12, netYear: net * 12,
      firstYear: net * 12 - setupCost,
      breakEvenMonths: net > 0 ? setupCost / net : null,
      hoursToCover: hourly > 0 ? toolCost / hourly : null,
      roi: toolCost > 0 ? (value * 12 - yearCost) / yearCost : null, // return on the money spent on plans
      awayH, keepsRunningH,
      cash, cashNet: cash - toolCost,
    };
  }

  // The tool set behind each comparison row. Plans you already pay for are in every row and never charged again.
  function buildOptions(s) {
    const known = (ids) => [...new Set((ids || []).filter((id) => TOOLS.some((t) => t.id === id)))];
    const owned = known(s.owned);
    const compare = known(s.compare).filter((id) => !owned.includes(id) && TOOLS.find((t) => t.id === id).monthly > 0);
    const base = [...new Set([...FREE_TOOLS, ...owned])];
    const withApp = s.useSahkarmi === false ? [] : ["sahkarmi"];
    const appText = withApp.length ? " with Sahkarmi" : "";
    const appShort = withApp.length ? " and Sahkarmi" : "";
    const opts = [{ id: "manual", label: "Keep doing it by hand", short: "no AI", tools: [], kind: "manual" }];
    opts.push({ id: "free", label: owned.length ? "The plans you already have" : "Free AI chat tools only", short: owned.length ? "the plans you already have" : "free AI chat tools", tools: base, kind: "free" });
    opts.push({ id: "browser", label: owned.length ? "Sahkarmi + the plans you already have" : "Sahkarmi + free AI models", short: owned.length ? "Sahkarmi and the plans you already have" : "Sahkarmi and free AI models", tools: [...base, "sahkarmi"], kind: "browser" });
    for (const id of compare) {
      const t = TOOLS.find((x) => x.id === id);
      opts.push({ id: `one:${id}`, label: `Add ${t.name}${t.from ? " (lowest tier)" : ""}${appText}`, short: `${t.name}${appShort}`, tools: [...base, id, ...withApp], kind: "one", plan: id });
    }
    if (compare.length > 1) opts.push({ id: "multi", label: `Add all ${compare.length} plans together${appText}`, short: `all ${compare.length} plans together`, tools: [...base, ...compare, ...withApp], kind: "multi" });
    return opts;
  }

  function compute(s, fx) {
    const sch = schedule(s);
    const hourly = hourlyValue(s, sch);
    const tasks = (s.tasks || []).filter((t) => t && t.enabled !== false);
    const owned = new Set(s.owned || []);
    const options = buildOptions(s).map((o) => {
      const tools = o.tools.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
      const newCosts = tools.filter((t) => !owned.has(t.id)).map((t) => planCost(t, s, fx));
      const perPerson = newCosts.some((c) => c === null) ? null : newCosts.reduce((a, c) => a + c, 0);
      const result = {};
      for (const level of Object.keys(SCENARIOS)) result[level] = summarise(tasks, sch, hourly, perPerson ?? 0, s, level, tools);
      // Free plans whose limits cap this option, and tasks it cannot help with at all.
      const capped = [...new Set(tasks.filter((t) => t.method !== "none" && t.fit !== "manual").map((t) => `${t.method}|${t.mode}`))]
        .filter((k) => { const [m, md] = k.split("|"); const c = capability(m, md, tools, 50); return c.share > 0 && c.share < 1; });
      const limitedTools = tools.filter((t) => t.limited && capped.some((k) => t.methods.includes(k.split("|")[0]) || (t.auto || []).includes(k.split("|")[0]))).map((t) => t.name);
      const uncovered = tasks.filter((t) => t.method !== "none" && t.fit !== "manual" && capability(t.method, "assist", tools, 100).share === 0).map((t) => t.name);
      const notAuto = tasks.filter((t) => t.method !== "none" && t.fit !== "manual" && t.mode === "auto" && !capability(t.method, "auto", tools, 100).auto).map((t) => t.name);
      return { ...o, toolCost: perPerson === null ? null : result.typical.toolCost, perPerson, priceMissing: perPerson === null, limitedTools, uncovered, notAuto, result };
    });
    // Best value: the highest typical net benefit, but a cheaper option within 5% of it wins.
    const ranked = options.filter((o) => o.id !== "manual" && !o.priceMissing)
      .sort((a, b) => b.result.typical.net - a.result.typical.net || a.toolCost - b.toolCost);
    let best = ranked[0];
    if (best && best.toolCost > 0) {
      const margin = Math.max(Math.abs(best.result.typical.net) * 0.05, 0.01);
      const cheaper = ranked.filter((o) => o.toolCost < best.toolCost && o.result.typical.net >= best.result.typical.net - margin)
        .sort((a, b) => a.toolCost - b.toolCost)[0];
      if (cheaper) best = cheaper;
    }
    if (!best || best.result.typical.net < 0 || best.result.typical.savedH <= 0) best = options[0];
    return { schedule: sch, hourly, tasks, options, bestId: best.id };
  }

  root.SavingsCalc = { PRICES_CHECKED, GST_RATE, TOOLS, FREE_TOOLS, SAHKARMI_ENGINES, TAX_NOTES, FX, CURRENCIES, METHODS, MODES, FITS, TASK_TYPES,
    PROFESSIONS, SCENARIOS, DEFAULTS, schedule, hourlyValue, convert, planCost, runsPerMonth, capability, taskResult, summarise, buildOptions, compute };
})(typeof window !== "undefined" ? window : globalThis);
