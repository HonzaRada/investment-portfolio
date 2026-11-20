import Decimal from "decimal.js";
import type { CnbRate } from "./cnb-rates.ts";
import type { Activity } from "./import-types.ts";

export type TaxActivity = Activity & { importId?: string; filename: string };
export type TaxCoverage = {
  filename: string;
  accounts: { id: string; from: string; to: string }[];
  issues: string[];
  untrackedCount: number;
};

type TaxAmount = { amount: string; currency: string; czk?: string; rate?: CnbRate };
type TaxLot = { purchase: TaxActivity; quantity: string; gross: TaxAmount; commission?: TaxAmount };

export type TaxRow = {
  activity: TaxActivity;
  gross: TaxAmount;
  commission?: TaxAmount;
  lots?: TaxLot[];
  note?: string;
};

export type RateLookup = (date: string, currency: string) => CnbRate | undefined;
const Money = Decimal.clone({ precision: 44 });
const reportKinds = new Set<Activity["kind"]>(["SELL", "DIVIDEND", "DIVIDEND_SUBSTITUTE", "WITHHOLDING", "INTEREST_RECEIVED", "INTEREST_PAID"]);

export const taxLabels: Partial<Record<Activity["kind"], string>> = {
  SELL: "Prodej",
  DIVIDEND: "Dividenda",
  DIVIDEND_SUBSTITUTE: "Náhrada dividendy",
  WITHHOLDING: "Srážka dle výpisu",
  INTEREST_RECEIVED: "Přijatý úrok",
  INTEREST_PAID: "Zaplacený úrok",
};

export function taxYear(value: string | null | undefined) {
  return value !== null && value !== undefined && /^(19[9]\d|20\d{2})$/.test(value) ? value : null;
}

function amountInCzk(amount: Decimal, currency: string, date: string, rateAt: RateLookup): TaxAmount {
  const rate = rateAt(date, currency);
  return {
    amount: amount.toFixed(),
    currency,
    czk: rate ? amount.mul(rate.amount).div(rate.units).toFixed(2) : undefined,
    rate,
  };
}

function daysApart(earlier: string, later: string) {
  return (Date.parse(later) - Date.parse(earlier)) / 86_400_000;
}

function coverageProblems(statements: TaxCoverage[], year: string) {
  const periods = new Map<string, TaxCoverage["accounts"]>();
  const firstProblem = new Map<string, string>();
  const alerts: string[] = [];

  const markProblem = (id: string, from: string) => {
    const current = firstProblem.get(id);
    if (!current || from < current) firstProblem.set(id, from);
  };

  for (const statement of statements) {
    const accounts = statement.accounts.filter(({ from }) => from <= `${year}-12-31`);
    if (!accounts.length) continue;
    for (const account of accounts) {
      const saved = periods.get(account.id) ?? [];
      saved.push(account);
      periods.set(account.id, saved);
      if (statement.issues.some((issue) => /Trades|CorporateActions|Transfers|OptionEAE|\bFOP\b|\bOPT\b/.test(issue))) {
        markProblem(account.id, account.from);
      }
    }
    if (statement.issues.length) alerts.push(`${statement.filename} · Import obsahuje upozornění.`);
    if (statement.untrackedCount) {
      alerts.push(`${statement.filename} · ${statement.untrackedCount} položek bez stabilního ID je dohledatelných ve výpisu.`);
    }
  }

  for (const [account, windows] of periods) {
    windows.sort((a, b) => a.from.localeCompare(b.from));
    let end = windows[0].to;
    for (const window of windows.slice(1)) {
      if (daysApart(end, window.from) > 1) {
        markProblem(account, window.from);
        alerts.push(`Účet ${account} · Mezera mezi výpisy po ${end} před ${window.from}.`);
        break;
      }
      if (window.to > end) end = window.to;
    }
  }

  return { firstProblem, alerts };
}

type RemainingLot = { purchase: TaxActivity; left: Decimal; original: Decimal };
type Holding = { lots: RemainingLot[]; firstLot: number; issue?: string };

function instrumentKey(event: TaxActivity) {
  return JSON.stringify([event.account, event.brokerInstrumentId]);
}

export function buildTaxReport(year: string, events: TaxActivity[], statements: TaxCoverage[], rateAt: RateLookup) {
  const { firstProblem, alerts } = coverageProblems(statements, year);
  const rows: TaxRow[] = [];
  const holdings = new Map<string, Holding>();
  const sameDay = new Map<string, number>();
  const sorted = events.filter((event) => event.date <= `${year}-12-31`).sort((a, b) =>
    a.date.localeCompare(b.date) || a.account.localeCompare(b.account) ||
    a.source.section.localeCompare(b.source.section) || (a.source.id ?? "").localeCompare(b.source.id ?? ""));

  for (const event of sorted) {
    if (!event.brokerInstrumentId || (event.kind !== "BUY" && event.kind !== "SELL")) continue;
    const day = JSON.stringify([instrumentKey(event), event.date]);
    sameDay.set(day, (sameDay.get(day) ?? 0) + 1);
  }

  for (const activity of sorted) {
    const { date, currency, amount, commission, kind } = activity;
    let matched: Pick<TaxRow, "lots" | "note"> = {};
    if (kind === "BUY" || kind === "SELL") {
      const problemDate = firstProblem.get(activity.account);
      matched = matchTrade(activity, holdings, sameDay, rateAt, Boolean(problemDate && problemDate <= date));
    }
    if (!date.startsWith(year) || !reportKinds.has(kind)) continue;

    rows.push({
      activity,
      gross: amountInCzk(new Money(amount), currency, date, rateAt),
      commission: commission ? amountInCzk(new Money(commission.amount), commission.currency, date, rateAt) : undefined,
      ...matched,
    });
  }

  return { year, rows, alerts: [...new Set(alerts)] };
}

function matchTrade(
  trade: TaxActivity,
  holdings: Map<string, Holding>,
  sameDay: Map<string, number>,
  rateAt: RateLookup,
  incompleteCoverage: boolean,
): Pick<TaxRow, "lots" | "note"> {
  if (!trade.brokerInstrumentId) return { note: "Chybí identifikátor instrumentu." };
  const key = instrumentKey(trade);
  const holding = holdings.get(key) ?? { lots: [], firstLot: 0 };
  holdings.set(key, holding);

  if (incompleteCoverage) holding.issue ??= "Historie účtu má mezeru nebo upozornění týkající se obchodů.";
  if ((sameDay.get(JSON.stringify([key, trade.date])) ?? 0) > 1) {
    holding.issue ??= "Ve stejný den proběhlo více obchodů a jejich pořadí není doložené.";
  }

  const quantity = new Money(trade.quantity ?? "0");
  const gross = new Money(trade.amount);
  if (!trade.source.id || (trade.kind === "BUY" ? !quantity.isPositive() || gross.gt(0) : !quantity.isNegative() || gross.lt(0)) || quantity.isZero()) {
    holding.issue ??= "Výpis postrádá jednoznačné údaje o obchodu.";
  }
  if (holding.issue) return { note: holding.issue };
  if (trade.kind === "BUY") {
    holding.lots.push({ purchase: trade, left: quantity, original: quantity });
    return {};
  }

  const lots: TaxLot[] = [];
  let left = quantity.abs();
  while (left.gt(0) && holding.firstLot < holding.lots.length) {
    const lot = holding.lots[holding.firstLot];
    const { purchase, original } = lot;
    const matched = Money.min(left, lot.left);
    lots.push({
      purchase,
      quantity: matched.toFixed(),
      gross: amountInCzk(new Money(purchase.amount).neg().mul(matched).div(original).toDecimalPlaces(12),
        purchase.currency, purchase.date, rateAt),
      commission: purchase.commission ? amountInCzk(
        new Money(purchase.commission.amount).neg().mul(matched).div(original).toDecimalPlaces(12),
        purchase.commission.currency, purchase.date, rateAt,
      ) : undefined,
    });
    left = left.minus(matched);
    lot.left = lot.left.minus(matched);
    if (lot.left.isZero()) holding.firstLot++;
  }
  if (left.gt(0)) {
    holding.issue = "Chybí dřívější nákup části pozice nebo jde o krátký prodej.";
    return { note: holding.issue };
  }
  return { lots };
}

function csvText(text: string | undefined) {
  if (!text) return "";
  const safe = /^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvNumber(value: string | undefined) {
  return value?.replace(".", ",") ?? "";
}

export function taxCsv(report: ReturnType<typeof buildTaxReport>) {
  const header = [
    "Rok přehledu", "Typ", "Datum z výpisu", "Účet", "Instrument", "Množství", "Částka", "Měna",
    "Datum kurzu ČNB", "Kurz v Kč", "Jednotek měny", "Částka Kč", "Komise", "Měna komise", "Datum kurzu pro komisi",
    "Kurz komise v Kč", "Jednotek měny komise", "Komise Kč", "Zdrojový výpis", "ID uloženého výpisu", "Sekce XML",
    "Řádek XML", "ID transakce", "Navázaný prodej", "ID výpisu prodeje", "Poznámka",
  ];
  const lines = [header.map(csvText).join(";")];
  for (const alert of report.alerts) {
    lines.push(header.map((_, index) => index === 0 ? report.year : index === 1 ? csvText("Kontrola importu") :
      index === header.length - 1 ? csvText(alert) : "").join(";"));
  }

  function line(activity: TaxActivity, type: string, gross: TaxAmount, commission?: TaxAmount,
    quantity?: string, note?: string, sale?: TaxActivity) {
    const notes = [note, !gross.rate || (commission && !commission.rate) ? "Chybí denní kurz ČNB." : undefined];
    return [
      report.year, csvText(type), csvText(activity.date), csvText(activity.account), csvText(activity.symbol), csvNumber(quantity),
      csvNumber(gross.amount), csvText(gross.currency), csvText(gross.rate?.date), csvNumber(gross.rate?.amount),
      csvNumber(gross.rate?.units), csvNumber(gross.czk), csvNumber(commission?.amount), csvText(commission?.currency),
      csvText(commission?.rate?.date), csvNumber(commission?.rate?.amount), csvNumber(commission?.rate?.units), csvNumber(commission?.czk),
      csvText(activity.filename), csvText(activity.importId), csvText(activity.source.section), String(activity.source.line),
      csvText(activity.source.id), csvText(sale?.source.id), csvText(sale?.importId), csvText(notes.filter(Boolean).join(" ")),
    ].join(";");
  }

  for (const row of report.rows) {
    const { activity, gross, commission, note, lots } = row;
    lines.push(line(activity, taxLabels[activity.kind] ?? activity.kind, gross, commission, activity.quantity, note));
    for (const lot of lots ?? []) {
      lines.push(line(lot.purchase, "Nákup přiřazený FIFO", lot.gross, lot.commission, lot.quantity, undefined, activity));
    }
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
