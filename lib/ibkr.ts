import Decimal from "decimal.js";
import { SaxesParser } from "saxes";
import {
  maxStatementBytes,
  type Activity,
  type CashBalance,
  type Position,
  type Source,
  type StatementPreview,
} from "./import-types.ts";

const Money = Decimal.clone({ precision: 50 });
type Attributes = Record<string, string>;
type Statement = StatementPreview["accounts"][number];
type CashTotal = { account: string; currency: string; amount: Decimal };

export class ImportError extends Error {}

function required(row: Attributes, field: string): string {
  const value = row[field]?.trim();
  if (!value) throw new ImportError(`Chybí pole ${field}.`);
  return value;
}

function date(value: string): string {
  const match = /^(\d{4})(-?)(\d{2})\2(\d{2})(?=$|[;T\s])/.exec(value);
  if (!match) throw new ImportError("Neplatné datum.");
  const formatted = `${match[1]}-${match[3]}-${match[4]}`;
  const time = new Date(formatted);
  if (Number.isNaN(time.getTime()) || time.toISOString().slice(0, 10) !== formatted) {
    throw new ImportError("Neplatné datum.");
  }
  return formatted;
}

function decimal(row: Attributes, field: string): string {
  const value = required(row, field);
  if (!/^[+-]?(?:\d{1,19}(?:\.\d{1,18})?|\.\d{1,18})$/.test(value)) {
    throw new ImportError(`Neplatné číslo v poli ${field}.`);
  }
  return new Money(value).toFixed();
}

function currency(row: Attributes, field = "currency"): string {
  const value = required(row, field).toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new ImportError(`Neplatná měna v poli ${field}.`);
  return value;
}

function readTrade(row: Attributes, account: string, source: Source): Activity {
  const side = required(row, "buySell");
  if (side !== "BUY" && side !== "SELL") throw new ImportError("Neznámý směr obchodu.");

  const tradeCurrency = currency(row);
  const commissionCurrency = row.ibCommissionCurrency ? currency(row, "ibCommissionCurrency") : tradeCurrency;
  const netCash = row.netCash && commissionCurrency === tradeCurrency ? decimal(row, "netCash") : undefined;
  return {
    account,
    source,
    date: date(row.tradeDate || required(row, "dateTime")),
    kind: side,
    symbol: required(row, "symbol"),
    brokerInstrumentId: row.conid,
    currency: tradeCurrency,
    quantity: decimal(row, "quantity"),
    amount: decimal(row, "proceeds"),
    commission: row.ibCommission ? { amount: decimal(row, "ibCommission"), currency: commissionCurrency } : undefined,
    netCash,
  };
}

function readCashTransaction(row: Attributes, account: string, source: Source): Activity {
  const originalType = required(row, "type");
  const amount = decimal(row, "amount");
  const cashCurrency = currency(row);
  const movement = new Money(amount).isNegative() ? "WITHDRAWAL" : "DEPOSIT";
  const kinds: Record<string, Activity["kind"]> = {
    Dividends: "DIVIDEND",
    "Payment In Lieu Of Dividends": "DIVIDEND_SUBSTITUTE",
    "Withholding Tax": "WITHHOLDING",
    "Deposits/Withdrawals": movement,
    "Deposits & Withdrawals": movement,
    "Broker Interest Received": "INTEREST_RECEIVED",
    "Broker Interest Paid": "INTEREST_PAID",
    "Other Fees": "FEE",
  };
  return {
    account,
    source,
    date: date(required(row, "dateTime")),
    kind: Object.hasOwn(kinds, originalType) ? kinds[originalType] : "OTHER",
    originalType,
    symbol: row.symbol ?? "",
    brokerInstrumentId: row.conid,
    currency: cashCurrency,
    amount,
    netCash: amount,
  };
}

function documentLimit(xml: string) {
  if (Buffer.byteLength(xml, "utf8") > maxStatementBytes) {
    throw new ImportError("Výpis je větší než 2 MB.");
  }
}

export function previewIbkr(xml: string): StatementPreview {
  documentLimit(xml);
  const preview: StatementPreview = { accounts: [], activities: [], positions: [], cash: [], issues: [] };
  const path: string[] = [];
  const unsupported = new Set<string>();
  const omittedCash = new Set<string>();
  const sectionsByAccount = new Map<string, Set<string>>();
  const detailByAccount = new Map<string, Map<string, boolean>>();
  const cashTotals = new Map<string, CashTotal>();
  const seenCash = new Set<string>();
  const seenActivities = new Map<string, string>();
  const seenPositions = new Set<string>();
  const parser = new SaxesParser();
  let statement: Statement | undefined;

  function note(message: string) {
    if (preview.issues.length < 30) preview.issues.push(message);
  }

  function markDetail(account: string, section: string, present: boolean) {
    const detail = detailByAccount.get(account)!;
    detail.set(section, present || detail.get(section) === true);
  }

  function addActivity(activity: Activity) {
    const { account, currency, netCash, source } = activity;
    if (source.id) {
      const key = JSON.stringify([account, source.section, source.id]);
      const fingerprint = JSON.stringify({ ...activity, source: undefined });
      const previous = seenActivities.get(key);
      if (previous === fingerprint) return;
      if (previous) throw new ImportError("Stejný identifikátor má rozdílné údaje.");
      seenActivities.set(key, fingerprint);
    }
    preview.activities.push(activity);
    const key = JSON.stringify([account, currency]);
    if (netCash === undefined) {
      omittedCash.add(account);
      return;
    }
    const total = cashTotals.get(key)?.amount ?? new Money(0);
    cashTotals.set(key, { account, currency, amount: total.plus(netCash) });
  }

  parser.on("doctype", () => {
    throw new ImportError("Výpis nesmí obsahovat deklaraci DOCTYPE.");
  });
  parser.on("error", () => {
    throw new ImportError(`Neplatné XML na řádku ${parser.line}.`);
  });

  parser.on("opentag", ({ name, attributes: row }) => {
    path.push(name);
    if (path.length > 48) throw new ImportError("XML má příliš hlubokou strukturu.");
    if (path.length === 1 && name !== "FlexQueryResponse") {
      throw new ImportError("Očekávám XML výpis Interactive Brokers Activity Flex Query.");
    }
    if (path[1] !== "FlexStatements") return;
    if (path.length === 3 && name === "FlexStatement") {
      const id = required(row, "accountId");
      if (sectionsByAccount.has(id)) throw new ImportError("Výpis obsahuje pro stejný účet více období. Nahraj každé období zvlášť.");
      const from = date(required(row, "fromDate"));
      const to = date(required(row, "toDate"));
      if (from > to) throw new ImportError("Datum začátku výpisu je po datu konce.");
      statement = { id, from, to };
      sectionsByAccount.set(id, new Set());
      detailByAccount.set(id, new Map());
      preview.accounts.push(statement);
      return;
    }
    if (!statement) return;

    const account = statement.id;
    const section = path[3];
    if (path.length === 4) {
      sectionsByAccount.get(account)?.add(section);
      return;
    }
    if (path.length !== 5) return;
    const line = parser.line;
    const source = { line, section };

    try {
      if (row.accountId && row.accountId !== account) {
        throw new ImportError("Řádek patří jinému účtu.");
      }
      if (section === "Trades" && name === "Trade") {
        markDetail(account, section, row.levelOfDetail === "EXECUTION");
        if (row.levelOfDetail !== "EXECUTION") {
          if (!row.levelOfDetail) throw new ImportError("V obchodech chybí úroveň detailu Execution.");
          return;
        }
        if (!["STK", "ETF"].includes(required(row, "assetCategory"))) {
          unsupported.add(row.assetCategory);
          omittedCash.add(account);
          return;
        }
        if (row.origTradeID && row.origTradeID !== "0") {
          throw new ImportError("Oprava obchodu vyžaduje kontrolu původního záznamu.");
        }
        addActivity(readTrade(row, account, { ...source, id: required(row, "tradeID") }));
      }

      if (section === "CashTransactions" && name === "CashTransaction") {
        const detail = row.levelOfDetail?.toUpperCase();
        markDetail(account, section, detail === "DETAIL");
        if (detail === "SUMMARY") return;
        if (detail !== "DETAIL") {
          throw new ImportError("Pohyby hotovosti musí být na úrovni Detail.");
        }
        addActivity(readCashTransaction(row, account, { ...source, id: row.transactionID }));
      }

      if (section === "OpenPositions" && name === "OpenPosition") {
        markDetail(account, section, row.levelOfDetail === "SUMMARY");
        if (row.levelOfDetail !== "SUMMARY") {
          if (!row.levelOfDetail) throw new ImportError("U otevřených pozic chybí úroveň detailu Summary.");
          return;
        }
        const assetCategory = required(row, "assetCategory");
        const conid = required(row, "conid");
        const positionCurrency = currency(row);
        const key = JSON.stringify([account, conid, positionCurrency, row.side]);
        if (seenPositions.has(key)) throw new ImportError("Výpis obsahuje duplicitní otevřenou pozici.");
        preview.positions.push({
          account,
          source: { ...source, id: conid },
          symbol: required(row, "symbol"),
          currency: positionCurrency,
          assetCategory,
          quantity: decimal(row, "position"),
          value: decimal(row, "positionValue"),
        });
        seenPositions.add(key);
      }

      if (section === "CashReport" && name === "CashReportCurrency") {
        if (row.currency === "BASE_SUMMARY") return;
        const cashCurrency = currency(row);
        const key = JSON.stringify([account, cashCurrency]);
        if (seenCash.has(key)) throw new ImportError("Výpis obsahuje více zůstatků pro jednu měnu.");
        preview.cash.push({
          account,
          currency: cashCurrency,
          opening: decimal(row, "startingCash"),
          closing: decimal(row, "endingCash"),
          source,
        });
        seenCash.add(key);
      }

      if (["CorporateActions", "Transfers", "OptionEAE", "FxTransactions"].includes(section)) {
        omittedCash.add(account);
        unsupported.add(section);
      }
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      note(`Řádek ${line} · ${section} · ${error.message}`);
      if (section === "Trades" || section === "CashTransactions") omittedCash.add(account);
    }
  });

  parser.on("closetag", () => {
    if (path.length === 3 && path[2] === "FlexStatement") statement = undefined;
    path.pop();
  });
  parser.write(xml).close();
  if (!preview.accounts.length) throw new ImportError("Výpis neobsahuje žádný účet.");

  for (const [account, sections] of sectionsByAccount) {
    const missing = ["Trades", "CashTransactions", "CashReport", "OpenPositions"].filter((name) => !sections.has(name));
    if (missing.length) note(`Účet ${account} · Chybějící sekce ${missing.join(", ")}.`);
    for (const [section, present] of detailByAccount.get(account)!) {
      if (present) continue;
      note(`Účet ${account} · Sekce ${section} postrádá očekávanou úroveň detailu.`);
      if (section !== "OpenPositions") omittedCash.add(account);
    }
    if (omittedCash.has(account)) note(`Účet ${account} · Úplný pohyb hotovosti se z dostupných položek nepodařilo odvodit.`);
  }
  if (unsupported.size) note(`Některé transakce nebyly zahrnuty · ${[...unsupported].join(", ")}.`);

  for (const { account, currency, amount } of cashTotals.values()) {
    if (!amount.isZero() && !seenCash.has(JSON.stringify([account, currency]))) {
      note(`Účet ${account} · Pro pohyby v ${currency} chybí zůstatek ve výpisu.`);
    }
  }

  preview.cash = preview.cash.map((balance): CashBalance => {
    const { account, currency } = balance;
    const sections = sectionsByAccount.get(account);
    if (omittedCash.has(account) || !sections?.has("CashTransactions") || !sections.has("Trades")) return balance;

    const delta = cashTotals.get(JSON.stringify([account, currency]))?.amount ?? new Money(0);
    const calculated = new Money(balance.opening).plus(delta);
    return { ...balance, calculated: calculated.toFixed(), difference: calculated.minus(balance.closing).toFixed() };
  });
  return preview;
}
