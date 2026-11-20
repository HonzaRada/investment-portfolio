import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { cnbRateAt, parseCnbArchive } from "@/lib/cnb-rates";
import { previewIbkr } from "@/lib/ibkr";
import { buildTaxReport, taxYear, type TaxActivity, type TaxCoverage } from "@/lib/tax-report";
import { authentication } from "./auth";
import { getDb } from "./db";
import { brokerActivities, statementImports } from "./db/schema";

const cnbArchive = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt";
const demoFilename = "ibkr-demo.xml";

async function loadEvents(userId?: string): Promise<{ events: TaxActivity[]; statements: TaxCoverage[] }> {
  if (!userId) {
    const xml = await readFile(join(process.cwd(), "public", demoFilename), "utf8");
    const { accounts, activities, issues } = previewIbkr(xml);
    return {
      events: activities.map((event) => ({ ...event, filename: demoFilename })),
      statements: [{ filename: demoFilename, accounts, issues, untrackedCount: 0 }],
    };
  }

  return getDb().transaction(async (tx) => {
    const rows = await tx.select({
      account: brokerActivities.account,
      section: brokerActivities.sourceSection,
      line: brokerActivities.sourceLine,
      id: brokerActivities.sourceId,
      importId: brokerActivities.firstImportId,
      activity: brokerActivities.activity,
      filename: statementImports.filename,
    }).from(brokerActivities).innerJoin(statementImports, and(
      eq(statementImports.id, brokerActivities.firstImportId),
      eq(statementImports.userId, brokerActivities.userId),
    )).where(eq(brokerActivities.userId, userId));

    const statements = await tx.select({
      filename: statementImports.filename,
      accounts: sql<TaxCoverage["accounts"]>`${statementImports.preview}->'accounts'`,
      issues: sql<string[]>`${statementImports.preview}->'issues'`,
      untrackedCount: sql<number>`jsonb_array_length(jsonb_path_query_array(
        ${statementImports.preview}, '$.activities[*] ? (!exists (@.source.id) || @.source.id == "")'
      ))`,
    }).from(statementImports).where(eq(statementImports.userId, userId));

    return {
      events: rows.map(({ account, section, line, id, importId, filename, activity }) => ({
        ...activity, account, filename, importId, source: { section, line, id },
      })),
      statements,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function readRates(year: string) {
  try {
    const response = await fetch(`${cnbArchive}?rok=${year}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? parseCnbArchive(await response.text()) : [];
  } catch {
    return [];
  }
}

export async function getTaxReport(requestedYear: string | null) {
  const session = await authentication?.auth();
  const userId = session?.user.id;
  const { events, statements } = await loadEvents(userId);
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Prague" }).format(new Date()));
  const years = new Set<string>();
  for (const statement of statements) {
    for (const { from, to } of statement.accounts) {
      for (let year = Math.max(1990, Number(from.slice(0, 4))); year <= Math.min(currentYear, Number(to.slice(0, 4))); year++) {
        years.add(String(year));
      }
    }
  }
  for (const event of events) {
    const year = taxYear(event.date.slice(0, 4));
    if (year && Number(year) <= currentYear) years.add(year);
  }

  const available = [...years].sort((a, b) => b.localeCompare(a));
  const year = requestedYear ?? available[0] ?? String(currentYear - 1);
  const rateYears = new Set<string>();
  for (const event of events) {
    const eventYear = event.date.slice(0, 4);
    if (eventYear > year || Number(eventYear) > currentYear || (event.currency === "CZK" && (!event.commission || event.commission.currency === "CZK"))) continue;
    if (event.kind !== "BUY" && eventYear !== year) continue;
    if (Number(eventYear) >= 1991) rateYears.add(eventYear);
    if (event.date.slice(5, 7) === "01" && Number(eventYear) > 1991) {
      rateYears.add(String(Number(eventYear) - 1));
    }
  }
  const days = (await Promise.all([...rateYears].map(readRates))).flat().sort((a, b) => a.date.localeCompare(b.date));
  const today = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Europe/Prague" }).format(new Date());
  const report = buildTaxReport(year, events, statements, (date, currency) => {
    const rate = cnbRateAt(days, date, currency);
    if (date > today || !rate || Date.parse(date) - Date.parse(rate.date) > 7 * 86_400_000) return undefined;
    return rate;
  });

  return { report, years: [...new Set([year, ...available])].sort((a, b) => b.localeCompare(a)), isDemo: !userId };
}
