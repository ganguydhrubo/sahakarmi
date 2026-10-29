// Checks the savings calculator maths against examples worked out by hand.
// Run: node scripts/test-savings.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("../website/assets/savings-calc.js", import.meta.url), "utf8"), ctx);
const C = ctx.SavingsCalc;

let failed = 0;
function near(name, actual, expected, tol = 0.01) {
  const ok = actual !== null && Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${actual} (expected ${expected})`);
}
function is(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${actual} (expected ${expected})`);
}
const email = { id: "e", type: "email", name: "Email", method: "chat", fit: "review", freq: 10, per: "day", manualMin: 8, aiMin: 3, reviewMin: 2, redoPct: 10, setupHours: 0.5 };
const code = { id: "c", type: "code", name: "Code", method: "code", fit: "review", freq: 3, per: "week", manualMin: 60, aiMin: 15, reviewMin: 10, redoPct: 10, setupHours: 1 };
const base = { ...C.DEFAULTS, owned: [], compare: [] };
const opt = (r, id) => r.options.find((o) => o.id === id);

// 1. Monthly pay ₹50,000; 8 h × 5 days × 48 weeks = 1,920 h a year → ₹312.50 an hour.
//    Email: 10 a day × 20 days = 200 runs; by hand 200 × 8 ÷ 60 = 26.667 h.
//    Paid plan: 3 + 2 + 10% × 8 = 5.8 min a run → 19.333 h; saved 7.333 h; worth ₹2,291.67.
//    Free plans only (50% of runs): 200 × (0.5 × 5.8 + 0.5 × 8) ÷ 60 = 23 h; saved 3.667 h; worth ₹1,145.83.
//    Claude Pro: $20 × 95.22 × 1.18 GST = ₹2,247.19; net 2,291.67 − 2,247.19 = ₹44.48.
{
  const r = C.compute({ ...base, tasks: [email], compare: ["claude-pro", "chatgpt-plus"] });
  near("hourly value", r.hourly, 312.5);
  near("runs a month", opt(r, "free").result.typical.rows[0].runs, 200);
  near("manual hours", opt(r, "free").result.typical.manualH, 26.6667, 0.001);
  near("free saved hours", opt(r, "free").result.typical.savedH, 3.6667, 0.001);
  near("free value", opt(r, "free").result.typical.value, 1145.83);
  near("Claude Pro cost with GST", opt(r, "one:claude-pro").toolCost, 2247.19);
  near("Claude Pro saved hours", opt(r, "one:claude-pro").result.typical.savedH, 7.3333, 0.001);
  near("Claude Pro net", opt(r, "one:claude-pro").result.typical.net, 44.48);
  near("ChatGPT Plus net (rupee price, no GST added)", opt(r, "one:chatgpt-plus").result.typical.net, 292.67);
  near("both plans together cost", opt(r, "multi").toolCost, 4246.19);
  is("best value is the free option", r.bestId, "free");
  is("free option has no return-on-spend figure", opt(r, "free").result.typical.roi, null);
  // Cautious: 5 × 1.5 + 15% × 8 = 8.7 min ≥ 8 by hand → no saving. Best case: 3.75 + 0.4 = 4.15 min → 12.833 h.
  near("cautious saves nothing", opt(r, "one:claude-pro").result.low.savedH, 0);
  near("best case saved hours", opt(r, "one:claude-pro").result.high.savedH, 12.8333, 0.001);
  near("setup hours counted once", opt(r, "one:claude-pro").result.typical.setupH, 0.5);
  near("first year", opt(r, "one:claude-pro").result.typical.firstYear, 44.48 * 12 - 0.5 * 312.5, 0.1);
}

// 2. $50 an hour, coding 3 a week × 4 weeks = 12 runs, 12 h by hand.
//    Paid: 15 + 10 + 10% × 60 = 31 min → 6.2 h; saved 5.8 h; worth $290.
//    Claude Pro yearly, no GST: $17; net $273; setup $50; first year 273 × 12 − 50 = $3,226;
//    pays back in 50 ÷ 273 = 0.183 months; return (290 × 12 − 254) ÷ 254 = 12.701.
//    Copilot Pro $10 saves the same → net $280, so it is the best value. Free (50%): saved 2.9 h, net $145.
{
  const s = { ...base, currency: "USD", payMode: "hourly", hourlyRate: 50, billing: "annual", addGst: false, tasks: [code], compare: ["claude-pro", "copilot-pro"] };
  const r = C.compute(s);
  const pro = opt(r, "one:claude-pro").result.typical;
  near("Claude Pro yearly cost", opt(r, "one:claude-pro").toolCost, 17);
  near("coding saved hours", pro.savedH, 5.8);
  near("coding net", pro.net, 273);
  near("coding first year", pro.firstYear, 3226);
  near("pays back (months)", pro.breakEvenMonths, 0.1832, 0.001);
  near("return in year one", pro.roi, 12.7008, 0.001);
  near("hours needed to cover the plan", pro.hoursToCover, 0.34);
  near("Copilot Pro net", opt(r, "one:copilot-pro").result.typical.net, 280);
  near("free coding saved hours", opt(r, "free").result.typical.savedH, 2.9);
  is("best value is Copilot Pro", r.bestId, "one:copilot-pro");
}

// 3. Currency: ChatGPT Plus ₹1,999 in US dollars = 1,999 ÷ 95.22 = $20.99; with a 3% card fee = $21.62.
{
  const plus = C.TOOLS.find((t) => t.id === "chatgpt-plus");
  near("rupee plan in dollars", C.planCost(plus, { currency: "USD", billing: "monthly", addGst: true, cardMarkupPct: 0 }), 20.9935);
  near("with 3% card fee", C.planCost(plus, { currency: "USD", billing: "monthly", addGst: true, cardMarkupPct: 3 }), 21.6233);
  near("AED peg", C.convert(1, "USD", "AED"), 3.6725, 0.00001);
}

// 4. The 5% rule: hourly ₹560 → free net 2,053.33, ChatGPT Plus net 2,107.67 (within 5%) → free wins.
//    At ₹700 → free 2,566.67, Plus 3,134.33 → Plus wins.
{
  const s = { ...base, payMode: "hourly", tasks: [email], compare: ["chatgpt-plus"] };
  const a = C.compute({ ...s, hourlyRate: 560 });
  near("free net at ₹560", opt(a, "free").result.typical.net, 2053.33);
  near("Plus net at ₹560", opt(a, "one:chatgpt-plus").result.typical.net, 2107.67);
  is("cheaper option within 5% wins", a.bestId, "free");
  is("Plus wins at ₹700", C.compute({ ...s, hourlyRate: 700 }).bestId, "one:chatgpt-plus");
}

// 5. Plans already paid for are in every option at no cost and are not offered again.
{
  const r = C.compute({ ...base, owned: ["claude-pro"], compare: ["claude-pro", "chatgpt-plus"], tasks: [email] });
  near("owned plan costs nothing", opt(r, "free").toolCost, 0);
  near("owned plan counts fully", opt(r, "free").result.typical.savedH, 7.3333, 0.001);
  is("owned plan not compared again", opt(r, "one:claude-pro"), undefined);
}

// 6. Odd and empty input.
{
  const none = C.compute({ ...base, tasks: [] });
  is("no tasks → keep doing it by hand", none.bestId, "manual");
  near("no tasks → zero hours", opt(none, "free").result.typical.savedH, 0);
  const manualTask = { ...email, method: "none", fit: "manual" };
  const m = C.compute({ ...base, tasks: [manualTask], compare: ["claude-pro"] });
  near("hand-only task saves nothing", opt(m, "one:claude-pro").result.typical.savedH, 0);
  near("hand-only task has no setup", opt(m, "one:claude-pro").result.typical.setupH, 0);
  const zeroPay = C.compute({ ...base, monthlyPay: 0, tasks: [email] });
  near("no pay → zero value", opt(zeroPay, "free").result.typical.value, 0);
  is("no pay → free option still best", zeroPay.bestId, "free");
  const junk = C.compute({ ...base, hoursPerDay: "", daysPerWeek: 99, weeksPerYear: -3, tasks: [{ ...email, freq: "abc", manualMin: -5 }] });
  near("blank hours a day → 8", junk.schedule.hoursPerDay, 8);
  near("99 days a week → 7", junk.schedule.daysPerWeek, 7);
  near("negative weeks → 1", junk.schedule.weeksPerYear, 1);
  near("junk task saves nothing", opt(junk, "free").result.typical.savedH, 0);
  const browserTask = { ...email, method: "browser" };
  const b = C.compute({ ...base, tasks: [browserTask] });
  near("free chat plans do not count for browser work", opt(b, "free").result.typical.savedH, 0);
  near("Sahkarmi counts for browser work (50%)", opt(b, "browser").result.typical.savedH, 3.6667, 0.001);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll savings calculator checks passed.");
process.exit(failed ? 1 : 0);
