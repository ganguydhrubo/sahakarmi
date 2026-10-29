// Writes website/assets/fx.json for the savings calculator: today's European Central Bank
// reference rates per 1 US dollar (via Frankfurter), plus the UAE dirham's fixed peg.
// Run at each website deploy. On any failure it leaves the committed file as it is.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../website/assets/fx.json", import.meta.url);
const URL_ = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR,EUR,GBP,SGD,AUD,CAD";

try {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const rates = { USD: 1, ...j.rates, AED: 3.6725 };
  for (const k of ["INR", "EUR", "GBP", "SGD", "AUD", "CAD"]) {
    if (!(Number(rates[k]) > 0)) throw new Error(`missing rate ${k}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date)) throw new Error("bad date");
  const old = JSON.parse(readFileSync(FILE, "utf8"));
  if (old.date > j.date) throw new Error(`service date ${j.date} is older than ${old.date}`);
  const out = { date: j.date, source: "European Central Bank reference rates, via Frankfurter", rates };
  writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`fx.json: rates of ${j.date}, 1 USD = ${rates.INR} INR`);
} catch (err) {
  console.log(`fx.json left unchanged: ${err.message}`);
}
