// Checks the savings calculator maths against examples worked out by hand.
// Run: node scripts/test-savings.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("../website/assets/savings-calc.js", import.meta.url), "utf8"), ctx);
const C = ctx.SavingsCalc;

let failed = 0;
function near(name, actual, expected, tol = 0.01) {
  const ok = actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${actual} (expected ${expected})`);
}
function is(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${actual} (expected ${expected})`);
}
const task = (type, extra = {}) => ({ id: type, name: type, ...C.TASK_TYPES[type], ...extra });
const base = { ...C.DEFAULTS, owned: [], compare: [] };
const opt = (r, id) => r.options.find((o) => o.id === id);

// Working year with the defaults: 5 days × 52 weeks − 10 public holidays = 250 business days.
// The person is away 15 leave + 6 sick = 21 days, so works 229 days × 8 h = 1,832 hours.
// Real cost of an hour: ₹50,000 × 12 × 1.25 (extra costs) ÷ 1,832 = ₹409.39.
const BD = 250, HOURS = 1832, HOURLY = (50000 * 12 * 1.25) / HOURS, PER_DAY = BD / 12, PER_WEEK = BD / 5 / 12;
{
  const r = C.compute({ ...base, tasks: [] });
  near("business days", r.schedule.businessDays, BD);
  near("days worked", r.schedule.workDays, 229);
  near("hours worked a year", r.schedule.hoursPerYear, HOURS);
  near("real cost of an hour", r.hourly, 409.3886, 0.001);
  near("share of business days away", r.schedule.awayShare, 0.084, 1e-9);
  // More leave means fewer worked hours, so each one costs more: 30 + 6 days → 214 days × 8 h = 1,712 h.
  near("more leave raises the hourly cost", C.compute({ ...base, leaveDays: 30, tasks: [] }).hourly, 750000 / 1712, 0.001);
}

// 1. Email, asking an AI each time: 10 a day × 250 ÷ 12 = 208.33 runs; by hand 208.33 × 8 ÷ 60 = 27.78 h.
//    With a paid plan: 2 + 2 + 10% × 8 = 4.8 min → 16.67 h; saved 11.11 h = 40% less time (as in Noy and Zhang).
//    Free chat tools only (50% of runs): 208.33 × (0.5 × 4.8 + 0.5 × 8) ÷ 60 = 22.22 h; saved 5.56 h.
//    Claude Pro: $20 × 95.22 × 1.18 GST = ₹2,247.19 a person.
{
  const r = C.compute({ ...base, tasks: [task("email")], compare: ["claude-pro", "chatgpt-plus"] });
  const pro = opt(r, "one:claude-pro").result.typical;
  near("email runs a month", pro.rows[0].runs, 10 * PER_DAY, 1e-9);
  near("email hours by hand", pro.manualH, (10 * PER_DAY * 8) / 60, 1e-9);
  near("email saved with Claude Pro", pro.savedH, (10 * PER_DAY * (8 - 4.8)) / 60, 1e-9);
  near("email: 40% less time", pro.pct, 0.4, 1e-9);
  near("email saved with free chat tools", opt(r, "free").result.typical.savedH, (10 * PER_DAY * (8 - 6.4)) / 60, 1e-9);
  near("Claude Pro cost with GST", opt(r, "one:claude-pro").toolCost, 2247.192, 1e-6);
  near("Claude Pro net a month", pro.net, ((10 * PER_DAY * 3.2) / 60) * HOURLY - 2247.192, 1e-6);
  near("ChatGPT Plus net (rupee price, no GST added)", opt(r, "one:chatgpt-plus").result.typical.net, ((10 * PER_DAY * 3.2) / 60) * HOURLY - 1999, 1e-6);
  near("net a year = 12 × month", pro.netYear, pro.net * 12, 1e-6);
  near("both plans together cost", opt(r, "multi").toolCost, 2247.192 + 1999, 1e-6);
  is("free option has no return-on-spend figure", opt(r, "free").result.typical.roi, null);
  // Cautious: (2 + 2) × 1.5 + 15% × 8 = 7.2 min. Best case: 4 × 0.75 + 5% × 8 = 3.4 min.
  near("cautious saved hours", opt(r, "one:claude-pro").result.low.savedH, (10 * PER_DAY * (8 - 7.2)) / 60, 1e-9);
  near("best case saved hours", opt(r, "one:claude-pro").result.high.savedH, (10 * PER_DAY * (8 - 3.4)) / 60, 1e-9);
}

// 2. Spreadsheet work set to run by itself: 1 a day → 20.83 runs × 30 min = 10.42 h by hand.
//    Running by itself, your time is checking + redo only: 3 + 10% × 30 = 6 min → 80% less time.
{
  const sheet = [task("spreadsheet")];
  const r = C.compute({ ...base, tasks: sheet, compare: ["claude-pro", "chatgpt-plus"] });
  const proApp = opt(r, "one:claude-pro").result.typical;
  near("Claude Pro with Sahkarmi: 80% less time", proApp.pct, 0.8, 1e-9);
  near("Claude Pro with Sahkarmi: saved hours", proApp.savedH, (PER_DAY * 24) / 60, 1e-9);
  is("runs by itself with Sahkarmi + Claude Pro", proApp.rows[0].auto, true);
  // Sahkarmi on free models: only 50% of runs → 20.83 × (0.5 × 6 + 0.5 × 30) ÷ 60 = 6.25 h; saved 4.17 h.
  near("Sahkarmi on free models (50% of runs)", opt(r, "browser").result.typical.savedH, PER_DAY * 12 / 60, 1e-9);
  // ChatGPT Plus has scheduled tasks for chat work, so it runs by itself too.
  near("ChatGPT Plus scheduled task: 80%", opt(r, "one:chatgpt-plus").result.typical.pct, 0.8, 1e-9);
  // Without Sahkarmi, Claude Pro cannot schedule it, so you ask each time: 5 + 3 + 3 = 11 min → 63.3%.
  const noApp = C.compute({ ...base, useSahkarmi: false, tasks: sheet, compare: ["claude-pro"] });
  near("Claude Pro alone: asks each time", opt(noApp, "one:claude-pro").result.typical.pct, (30 - 11) / 30, 1e-9);
  is("Claude Pro alone notes it cannot run by itself", opt(noApp, "one:claude-pro").notAuto.length, 1);
  // Free chat tools only: no scheduling, 50% of runs: 20.83 × (0.5 × 11 + 0.5 × 30) ÷ 60.
  near("free chat tools: asks each time, half the runs", opt(r, "free").result.typical.savedH, (PER_DAY * (30 - 20.5)) / 60, 1e-9);
}

// 3. A team of 10 doing email + spreadsheet work, with Claude Pro and Sahkarmi.
//    Saved per person: 11.11 + 8.33 = 19.44 h; team 194.44 h a month out of 381.94 h by hand (50.9% less).
//    Plans: 10 × ₹2,247.19. Setup: 0.5 + 2 h once + 2 h learning × 10 people = 22.5 h.
//    Like 194.44 ÷ (1,832 ÷ 12) = 1.27 extra people. Leave cover: 381.94 × 21 ÷ 250 = 32.08 h,
//    of which the spreadsheet's 10.42 × 10 × 0.084 = 8.75 h keeps running by itself.
{
  const r = C.compute({ ...base, people: 10, tasks: [task("email"), task("spreadsheet")], compare: ["claude-pro"] });
  const T = opt(r, "one:claude-pro").result.typical;
  const saved = 10 * ((PER_DAY * 10 * 3.2) / 60 + (PER_DAY * 24) / 60), manual = 10 * ((PER_DAY * 80) / 60 + (PER_DAY * 30) / 60);
  near("team hours saved", T.savedH, saved, 1e-9);
  near("team hours by hand", T.manualH, manual, 1e-9);
  near("team % less time", T.pct, saved / manual, 1e-9);
  near("team plan cost", T.toolCost, 22471.92, 1e-6);
  near("team value a month", T.value, saved * HOURLY, 1e-6);
  near("team net a year", T.netYear, (saved * HOURLY - 22471.92) * 12, 1e-4);
  near("setup hours", T.setupH, 22.5, 1e-9);
  near("first year", T.firstYear, (saved * HOURLY - 22471.92) * 12 - 22.5 * HOURLY, 1e-4);
  near("like extra people", T.peopleEquiv, saved / (HOURS / 12), 1e-9);
  near("leave and sick cover hours", T.awayH, manual * 0.084, 1e-9);
  near("cover that keeps running by itself", T.keepsRunningH, 10 * ((PER_DAY * 30) / 60) * 0.084, 1e-9);
}

// 4. $50 an hour (all-in), coding 3 a week × 50 business weeks ÷ 12 = 12.5 runs, 12.5 h by hand.
//    Paid plan: 12 + 10 + 10% × 60 = 28 min → 5.83 h; saved 6.67 h (53% less, as in Peng et al.); worth $333.33.
//    Claude Pro yearly, no GST: $17; net $316.33; setup 1 h + 2 h learning = $150;
//    first year 316.33 × 12 − 150 = $3,646; pays back in 150 ÷ 316.33 = 0.474 months;
//    return (333.33 × 12 − (17 × 12 + 150)) ÷ 354 = 10.30. Copilot Pro $10 → net $323.33, the best value.
{
  const s = { ...base, currency: "USD", payMode: "hourly", hourlyRate: 50, billing: "annual", addGst: false, tasks: [task("code")], compare: ["claude-pro", "copilot-pro"] };
  const r = C.compute(s);
  const pro = opt(r, "one:claude-pro").result.typical;
  near("coding runs", pro.rows[0].runs, 3 * PER_WEEK, 1e-9);
  near("Claude Pro yearly cost", opt(r, "one:claude-pro").toolCost, 17);
  near("coding saved hours", pro.savedH, (12.5 * 32) / 60, 1e-9);
  near("coding net", pro.net, (12.5 * 32 / 60) * 50 - 17, 1e-9);
  near("coding first year", pro.firstYear, ((12.5 * 32 / 60) * 50 - 17) * 12 - 150, 1e-6);
  near("pays back (months)", pro.breakEvenMonths, 150 / ((12.5 * 32 / 60) * 50 - 17), 1e-9);
  near("return in year one", pro.roi, ((12.5 * 32 / 60) * 50 * 12 - 354) / 354, 1e-9);
  near("Copilot Pro net", opt(r, "one:copilot-pro").result.typical.net, (12.5 * 32 / 60) * 50 - 10, 1e-9);
  is("best value is Copilot Pro", r.bestId, "one:copilot-pro");
}

// 5. Currency: ChatGPT Plus ₹1,999 in US dollars = 1,999 ÷ 95.22 = $20.99; with a 3% card fee = $21.62.
{
  const plus = C.TOOLS.find((t) => t.id === "chatgpt-plus");
  near("rupee plan in dollars", C.planCost(plus, { currency: "USD", billing: "monthly", addGst: true, cardMarkupPct: 0 }), 1999 / 95.22, 1e-9);
  near("with 3% card fee", C.planCost(plus, { currency: "USD", billing: "monthly", addGst: true, cardMarkupPct: 3 }), (1999 / 95.22) * 1.03, 1e-9);
  near("AED peg", C.convert(1, "USD", "AED"), 3.6725, 1e-9);
}

// 6. The 5% rule, email only, all-in hourly cost h: free saves 5.556 h, ChatGPT Plus 11.111 h.
//    At ₹360: free 2,000.00 vs Plus 4,000 − 1,999 = 2,001.00 (within 5%) → free wins. At ₹500 → Plus wins.
{
  const s = { ...base, payMode: "hourly", tasks: [task("email")], compare: ["chatgpt-plus"] };
  const a = C.compute({ ...s, hourlyRate: 360 });
  near("free net at ₹360", opt(a, "free").result.typical.net, 2000, 1e-6);
  near("Plus net at ₹360", opt(a, "one:chatgpt-plus").result.typical.net, 2001, 1e-6);
  is("cheaper option within 5% wins", a.bestId, "free");
  is("Plus wins at ₹500", C.compute({ ...s, hourlyRate: 500 }).bestId, "one:chatgpt-plus");
}

// 7. Plans already paid for are in every option at no cost, and let Sahkarmi run without free-model limits.
{
  const r = C.compute({ ...base, owned: ["claude-pro"], compare: ["claude-pro", "chatgpt-plus"], tasks: [task("email"), task("spreadsheet")] });
  near("owned plan costs nothing", opt(r, "free").toolCost, 0);
  near("owned plan counts fully for asking each time", opt(r, "free").result.typical.rows[0].savedH, (PER_DAY * 10 * 3.2) / 60, 1e-9);
  near("Sahkarmi on your own Claude Pro runs every run", opt(r, "browser").result.typical.rows[1].share, 1);
  is("owned plan not compared again", opt(r, "one:claude-pro"), undefined);
}

// 8. Odd and empty input.
{
  const none = C.compute({ ...base, tasks: [] });
  is("no tasks → keep doing it by hand", none.bestId, "manual");
  near("no tasks → zero hours", opt(none, "free").result.typical.savedH, 0);
  near("no tasks → 0% less time", opt(none, "free").result.typical.pct, 0);
  const m = C.compute({ ...base, tasks: [task("meetings")], compare: ["claude-pro"] });
  near("hand-only task saves nothing", opt(m, "one:claude-pro").result.typical.savedH, 0);
  near("no saving → no setup or learning", opt(m, "one:claude-pro").result.typical.setupH, 0);
  const zeroPay = C.compute({ ...base, monthlyPay: 0, tasks: [task("email")] });
  near("no salary → zero value", opt(zeroPay, "free").result.typical.value, 0);
  is("no salary → free option still best", zeroPay.bestId, "free");
  const junk = C.compute({ ...base, people: "abc", hoursPerDay: "", daysPerWeek: 99, holidays: -3, leaveDays: 900, tasks: [task("email", { freq: "abc", manualMin: -5 })] });
  near("bad team size → 1", opt(junk, "free").result.typical.people, 1);
  near("blank hours a day → 8", junk.schedule.hoursPerDay, 8);
  near("99 days a week → 7", junk.schedule.daysPerWeek, 7);
  near("negative holidays → 0", junk.schedule.holidays, 0);
  near("leave cannot exceed the year", junk.schedule.workDays, 1);
  near("junk task saves nothing", opt(junk, "free").result.typical.savedH, 0);
  const b = C.compute({ ...base, tasks: [task("dataentry")] });
  near("free chat tools cannot do website work", opt(b, "free").result.typical.savedH, 0);
  // Sahkarmi on free models, 50% of runs: 3 a day → 62.5 runs × (0.5 × (2 + 2) + 0.5 × 20) ÷ 60.
  near("Sahkarmi does website work by itself (50% on free models)", opt(b, "browser").result.typical.savedH, (62.5 * (20 - 12)) / 60, 1e-9);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll savings calculator checks passed.");
process.exit(failed ? 1 : 0);
