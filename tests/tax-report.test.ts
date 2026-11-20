import assert from "node:assert/strict";
import { test } from "node:test";
import { cnbRateAt, parseCnbArchive } from "../lib/cnb-rates.ts";
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
  assert.match(csv, /"d1";;;"Chybí denní kurz ČNB\."/);
});
