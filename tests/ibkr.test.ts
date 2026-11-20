import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { previewIbkr } from "../lib/ibkr.ts";

const demo = readFileSync(new URL("../public/ibkr-demo.xml", import.meta.url), "utf8");

test("reads cash and positions, preserving currency, precision and XML provenance", () => {
  const preview = previewIbkr(demo);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.positions.length, 3);
  assert.deepEqual(preview.cash.map(({ currency, calculated, difference }) => [currency, calculated, difference]), [
    ["USD", "2798.77", "0"],
    ["EUR", "558.75", "0"],
  ]);
  assert.equal(preview.activities.length, 8);
  const sale = preview.activities.find(({ source }) => source.id === "10004");
  assert.equal(sale?.quantity, "-2");
  assert.equal(sale?.kind, "SELL");
  assert.equal(sale?.source.line, 9);
});

test("does not reconcile balances using order summaries alone", () => {
  const preview = previewIbkr(demo.replaceAll('levelOfDetail="EXECUTION"', 'levelOfDetail="ORDER"'));
  assert.equal(preview.cash[0].calculated, undefined);
  assert.ok(preview.issues.some((issue) => issue.includes("sekce Trades") || issue.includes("Sekce Trades")));
});

test("ignores overlapping summary rows and identical trade IDs", () => {
  const trade = demo.split("\n").find((line) => line.includes('tradeID="10001"'))!;
  const repeated = demo.replace(trade, [trade, trade, trade.replace("EXECUTION", "ORDER")].join("\n"));
  const preview = previewIbkr(repeated);
  assert.equal(preview.activities.length, 8);
  assert.equal(preview.cash.find(({ currency }) => currency === "USD")?.difference, "0");
});

test("reports discrepancies and declines to reconcile an unsupported FX trade", () => {
  const discrepancy = previewIbkr(demo.replace('endingCash="2798.77"', 'endingCash="2800"'));
  assert.equal(discrepancy.cash[0].difference, "-1.23");

  const withFxOnly = previewIbkr(demo.replace('assetCategory="STK" tradeID="10001"', 'assetCategory="CASH" tradeID="10001"'));
  assert.equal(withFxOnly.cash[0].difference, undefined);
  assert.ok(withFxOnly.issues.some((issue) => issue.includes("CASH")));
});

test("rejects malformed XML and XML with a document type", () => {
  assert.throws(() => previewIbkr("<FlexQueryResponse>"), /Neplatné XML/);
  assert.throws(() => previewIbkr('<!DOCTYPE FlexQueryResponse SYSTEM "file:///example"><FlexQueryResponse/>'), /DOCTYPE/);
  assert.throws(() => previewIbkr("<report/>"), /Interactive Brokers/);
});
