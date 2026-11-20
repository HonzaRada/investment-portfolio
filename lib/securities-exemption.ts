import Decimal from "decimal.js";
import type { CnbRate } from "./cnb-rates.ts";

const Money = Decimal.clone({ precision: 44 });
const grossThresholdCzk = "100000";
const timeTestYears = 3;

const taxAuthority2025 =
  "https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr/tiskove-zpravy-2026/danove-priznani-za-rok-2025-pripominame";
const taxAuthority2026 =
  "https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr/tiskove-zpravy-2026/danove-novinky-pro-rok-2026";

export function securitiesRules(year: string) {
  if (year === "2025") return { grossThresholdCzk, timeTestYears, timeTestCapCzk: "40000000", source: taxAuthority2025 };
  if (year === "2026") return { grossThresholdCzk, timeTestYears, timeTestCapCzk: null, source: taxAuthority2026 };
  return null;
}

export type HoldingCheck =
  | { status: "shorter" | "anniversary" | "longer"; anniversary: string; years: number }
  | { status: "historic" };

export function checkHoldingPeriod(boughtOn: string, soldOn: string, years: number): HoldingCheck {
  // Purchases before 2014 can fall under transitional provisions.
  if (boughtOn < "2014-01-01") return { status: "historic" };

  const [year, month, day] = boughtOn.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const anniversary = [targetYear, month, Math.min(lastDay, day)]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
  const status = soldOn > anniversary ? "longer" : soldOn === anniversary ? "anniversary" : "shorter";
  return { status, anniversary, years };
}

export function holdingCheckLabel(check: HoldingCheck) {
  if (check.status === "historic") return "Nabytí před rokem 2014 · k ověření";
  if (check.status === "longer") return `Držba přes ${check.years} roky podle výpisu`;
  if (check.status === "anniversary") return `Přesně ${check.years} roky podle výpisu`;
  return `Držba kratší než ${check.years} roky podle výpisu`;
}

type ReportSale = { amount: string; rate?: CnbRate };

export function summarizeSecuritiesSales(rules: NonNullable<ReturnType<typeof securitiesRules>>, sales: ReportSale[]) {
  let total = new Money(0);
  let counted = 0;
  for (const sale of sales) {
    const amount = new Money(sale.amount);
    if (!sale.rate || amount.lt(0)) continue;
    total = total.plus(amount.mul(sale.rate.amount).div(sale.rate.units));
    counted++;
  }
  const missing = sales.length - counted;
  // Compare before rounding the display amount to haléře.
  const limit = new Money(rules.grossThresholdCzk);
  const comparison = total.gt(limit) ? "above" : !counted || missing ? "unknown" : total.eq(limit) ? "at" : "below";
  return {
    ...rules,
    grossCzk: counted ? total.toFixed(2) : null,
    counted,
    missing,
    comparison,
  } as const;
}

export function securitiesValueLabel(comparison: ReturnType<typeof summarizeSecuritiesSales>["comparison"]) {
  if (comparison === "above") return "Evidovaný součet překračuje hranici.";
  if (comparison === "at") return "Evidovaný součet je přesně na hranici.";
  if (comparison === "below") return "Evidovaný součet je pod hranicí.";
  return "Z přepočtených položek zatím nelze rozhodnout.";
}

export function securitiesCapNote(year: string, cap: string | null) {
  if (cap) {
    const limit = new Intl.NumberFormat("cs-CZ").format(BigInt(cap));
    return `V roce ${year} se při osvobození na základě doby držby uplatňoval společný limit ${limit} Kč. Kontrola vyžaduje i údaje o dalších příjmech zahrnovaných do tohoto limitu.`;
  }
  return "Od roku 2026 byl limit 40 000 000 Kč pro osvobození prodeje cenných papírů na základě doby držby zrušen.";
}
