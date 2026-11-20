import assert from "node:assert/strict";
import { test } from "node:test";
import { cnbRateAt, parseCnbArchive } from "../lib/cnb-rates.ts";
import { checkHoldingPeriod, securitiesRules } from "../lib/securities-exemption.ts";
import { buildTaxReport, taxCsv, type RateLookup, type TaxActivity, type TaxCoverage } from "../lib/tax-report.ts";

function trade(kind: "BUY" | "SELL", date: string, quantity: string, amount: string, id: string): TaxActivity {
  return {
    account: "U1", filename: "obchody.xml", symbol: "ACME", brokerInstrumentId: "123",
    kind, date, quantity, amount, currency: "USD", source: { section: "Trades", id, line: 2 },
  };
}

const rateAt: RateLookup = (date, currency) => ({
  date, amount: currency === "GBP" ? "30" : date.startsWith("2024") ? "23" : "25", units: "1",
});

test("FIFO uses earlier years and splits partial purchases and commissions at the purchase dates", () => {
  const first = trade("BUY", "2024-12-01", "3", "-300", "b1");
  const second = { ...trade("BUY", "2025-01-03", "2", "-400", "b2"), commission: { amount: "-1.6", currency: "GBP" } };
  const sale = trade("SELL", "2025-06-01", "-4", "1200", "s1");
  const leftover = trade("SELL", "2025-06-05", "-1", "350", "s2");
  const { rows } = buildTaxReport("2025", [sale, leftover, second, first], [], rateAt);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].gross.czk, "30000.00");
  assert.deepEqual(rows[0].lots?.map((lot) => [lot.purchase.source.id, lot.quantity, lot.gross.czk, lot.commission?.czk]), [
    ["b1", "3", "6900.00", undefined],
    ["b2", "1", "5000.00", "24.00"],
  ]);
  assert.deepEqual(rows[1].lots?.map((lot) => [lot.purchase.source.id, lot.quantity]), [["b2", "1"]]);
});

test("missing history, a second account, and ambiguous same-day ordering leave a sale for review", () => {
  const first = trade("BUY", "2025-01-10", "3", "-300", "b1");
  const sale = trade("SELL", "2025-03-01", "-2", "500", "s1");
  const foreignAccount = { ...sale, account: "U2" };
  const sameDay = { ...first, date: sale.date };
  assert.match(buildTaxReport("2025", [first, foreignAccount], [], rateAt).rows[0].note ?? "", /Chybí/);
  assert.match(buildTaxReport("2025", [sameDay, sale], [], rateAt).rows[0].note ?? "", /pořadí/);
  const statements: TaxCoverage[] = [
    { filename: "leden.xml", accounts: [{ id: "U1", from: "2025-01-01", to: "2025-01-31" }], issues: [], untrackedCount: 0 },
    { filename: "březen.xml", accounts: [{ id: "U1", from: "2025-03-01", to: "2025-03-31" }], issues: [], untrackedCount: 0 },
  ];
  const report = buildTaxReport("2025", [first, sale], statements, rateAt);
  assert.match(report.rows[0].note ?? "", /mezeru/);
  assert.match(report.alerts[0], /Mezera/);
});

test("ČNB archive uses the last fixing and preserves units, even when a header changes", () => {
  const current = parseCnbArchive("Datum|1 EUR|100 JPY\n03.01.2025|25,123|15,500\nDatum|1 EUR\n06.01.2025|25,125\n");
  const weekend = cnbRateAt(current, "2025-01-05", "JPY");
  assert.deepEqual(weekend, { date: "2025-01-03", amount: "15.500", units: "100" });
  assert.equal(cnbRateAt(current, "2025-01-06", "JPY"), undefined);
  const dividend: TaxActivity = { ...trade("SELL", "2025-01-05", "-1", "200", "d1"), kind: "DIVIDEND", currency: "JPY" };
  const { rows } = buildTaxReport("2025", [dividend], [], (date, currency) => cnbRateAt(current, date, currency));
  assert.equal(rows[0].gross.czk, "31.00");
});

test("CSV keeps source identifiers, does not zero missing amounts, and escapes formula-like text", () => {
  const dividend = { ...trade("SELL", "2025-06-01", "-1", "20.5", "d1"), kind: "DIVIDEND", symbol: " =1+2" } as const;
  const csv = taxCsv(buildTaxReport("2025", [dividend], [], () => undefined));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"' =1\+2";-1;20,5;"USD";/);
  assert.match(csv, /"d1";;;;;"Chybí denní kurz ČNB\."/);
});

test("the holding check uses the anniversary and preserves the 2025 and 2026 rule differences", () => {
  assert.deepEqual(checkHoldingPeriod("2020-02-29", "2023-02-27", 3),
    { status: "shorter", anniversary: "2023-02-28", years: 3 });
  assert.equal(checkHoldingPeriod("2020-02-29", "2023-02-28", 3).status, "anniversary");
  assert.equal(checkHoldingPeriod("2020-02-29", "2023-03-01", 3).status, "longer");
  assert.equal(checkHoldingPeriod("2013-12-31", "2025-03-01", 3).status, "historic");
  assert.equal(securitiesRules("2025")?.timeTestCapCzk, "40000000");
  assert.equal(securitiesRules("2026")?.timeTestCapCzk, null);
  assert.equal(securitiesRules("2024"), null);
});

test("gross proceeds use all tracked sales and compare before rounding, omitting unknown amounts", () => {
  const sale = { ...trade("SELL", "2025-06-01", "-1", "100000", "s1"), currency: "CZK",
    commission: { amount: "-200", currency: "CZK" } };
  const missing = { ...sale, currency: "USD", source: { ...sale.source, id: "s2" } };
  const dividend = { ...sale, kind: "DIVIDEND", amount: "500" } as const;
  const czkOnly: RateLookup = (date, currency) => currency === "CZK" ? { date, amount: "1", units: "1" } : undefined;
  const exact = buildTaxReport("2025", [sale, dividend], [], czkOnly);
  assert.equal(exact.securities?.grossCzk, "100000.00");
  assert.equal(exact.securities?.comparison, "at");
  const incomplete = buildTaxReport("2025", [sale, missing], [], czkOnly);
  assert.equal(incomplete.securities?.comparison, "unknown");
  assert.equal(incomplete.securities?.missing, 1);
  const above = buildTaxReport("2025", [{ ...sale, amount: "100000.0001" }, missing], [], czkOnly);
  assert.equal(above.securities?.grossCzk, "100000.00");
  assert.equal(above.securities?.comparison, "above");
});

test("CSV includes separate holding dates for long and short lots assigned to a single sale", () => {
  const old = trade("BUY", "2020-04-10", "1", "-200", "b1");
  const recent = trade("BUY", "2025-01-10", "1", "-300", "b2");
  const sale = trade("SELL", "2025-05-01", "-2", "500", "s1");
  const report = buildTaxReport("2025", [old, recent, sale], [], rateAt);
  assert.deepEqual(report.rows[0].lots?.map((lot) => lot.holdingCheck?.status), ["longer", "shorter"]);
  const csv = taxCsv(report);
  assert.match(csv, /Hodnotový test · evidovaný součet/);
  assert.match(csv, /"2023-04-10";"Držba přes 3 roky podle výpisu"/);
  assert.match(csv, /"2028-01-10";"Držba kratší než 3 roky podle výpisu"/);
});
