import { createHash } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { previewIbkr } from "../lib/ibkr.ts";
import type { SavedStatement, StatementHistory } from "../lib/import-types.ts";
import { getDb } from "./db/index.ts";
import { brokerActivities, statementImports } from "./db/schema.ts";

const broker = "IBKR";
const pageSize = 15;
const activityBatchSize = 500;
const summaryColumns = {
  id: statementImports.id,
  filename: statementImports.filename,
  savedAt: statementImports.savedAt,
};

export class ActivityConflict extends Error {}

function summary({ id, filename, savedAt }: { id: string; filename: string; savedAt: Date }): SavedStatement {
  return { id, filename, savedAt: savedAt.toISOString() };
}

export async function listStatements(userId: string, olderThan?: StatementHistory["next"]): Promise<StatementHistory> {
  const rows = await getDb().select(summaryColumns).from(statementImports)
    .where(and(
      eq(statementImports.userId, userId),
      olderThan ? or(
        lt(statementImports.savedAt, new Date(olderThan.savedAt)),
        and(eq(statementImports.savedAt, new Date(olderThan.savedAt)), lt(statementImports.id, olderThan.id)),
      ) : undefined,
    ))
    .orderBy(desc(statementImports.savedAt), desc(statementImports.id))
    .limit(pageSize + 1);
  const statements = rows.slice(0, pageSize).map(summary);
  const last = statements.at(-1);
  return { statements, next: rows.length > pageSize && last ? { id: last.id, savedAt: last.savedAt } : undefined };
}

export async function readStatement(userId: string, id: string) {
  const [row] = await getDb().select({ ...summaryColumns, preview: statementImports.preview }).from(statementImports)
    .where(and(eq(statementImports.userId, userId), eq(statementImports.id, id)));
  return row ? { statement: summary(row), preview: row.preview } : null;
}

export async function readStatementXml(userId: string, id: string) {
  const [row] = await getDb().select({ xml: statementImports.xml }).from(statementImports)
    .where(and(eq(statementImports.userId, userId), eq(statementImports.id, id)));
  return row?.xml ?? null;
}

export async function saveStatement(userId: string, filename: string, xml: string) {
  const sha256 = createHash("sha256").update(xml).digest("hex");
  const preview = previewIbkr(xml);

  return getDb().transaction(async (tx) => {
    const [created] = await tx.insert(statementImports).values({ userId, broker, filename, sha256, xml, preview })
      .onConflictDoNothing({ target: [statementImports.userId, statementImports.broker, statementImports.sha256] })
      .returning(summaryColumns);

    if (!created) {
      const [duplicate] = await tx.select(summaryColumns).from(statementImports)
        .where(and(eq(statementImports.userId, userId), eq(statementImports.broker, broker), eq(statementImports.sha256, sha256)));
      if (!duplicate) throw new Error("Duplicate import was not found.");
      return { statement: summary(duplicate), created: false };
    }

    // The original statement still contains rows for which the broker omitted a stable ID.
    const events = preview.activities.flatMap(({ account, source, originalType, ...activity }) =>
      source.id ? [{
        userId,
        broker,
        account,
        firstImportId: created.id,
        sourceId: source.id,
        sourceSection: source.section,
        sourceLine: source.line,
        activity: activity.kind === "OTHER" ? { ...activity, originalType } : activity,
      }] : [],
    );
    // Use the same order for overlapping imports to acquire conflict row locks consistently.
    events.sort((left, right) => {
      const a = [left.account, left.sourceSection, left.sourceId].join("\0");
      const b = [right.account, right.sourceSection, right.sourceId].join("\0");
      return a < b ? -1 : a > b ? 1 : 0;
    });

    for (let start = 0; start < events.length; start += activityBatchSize) {
      const batch = events.slice(start, start + activityBatchSize);
      const accepted = await tx.insert(brokerActivities).values(batch).onConflictDoUpdate({
        target: [brokerActivities.userId, brokerActivities.broker, brokerActivities.account, brokerActivities.sourceSection, brokerActivities.sourceId],
        set: { sourceId: sql`excluded.source_id` },
        setWhere: sql`${brokerActivities.activity} = excluded.activity`,
      }).returning({ id: brokerActivities.id });
      if (accepted.length !== batch.length) {
        throw new ActivityConflict("Výpis mění údaje dříve uložené transakce. Zkontroluj, zda broker obchod opravil.");
      }
    }

    return { statement: summary(created), created: true };
  });
}
