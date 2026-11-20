import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Activity, StatementPreview } from "../../lib/import-types.ts";

export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(),
  name: text(),
  email: text().notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text(),
});

export const authAccounts = pgTable("auth_accounts", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text().$type<AdapterAccountType>().notNull(),
  provider: text().notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  access_token: text(),
  refresh_token: text(),
  expires_at: integer(),
  token_type: text(),
  scope: text(),
  id_token: text(),
  session_state: text(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
  index("auth_accounts_user_idx").on(table.userId),
]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ mode: "date", withTimezone: true }).notNull(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const statementImports = pgTable("statement_imports", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  broker: text().notNull(),
  filename: text().notNull(),
  sha256: text().notNull(),
  xml: text().notNull(),
  preview: jsonb().$type<StatementPreview>().notNull(),
  savedAt: timestamp("saved_at", { mode: "date", withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  unique("statement_imports_user_broker_sha256_key").on(table.userId, table.broker, table.sha256),
  index("statement_imports_history_idx").on(table.userId, table.savedAt, table.id),
]);

export const brokerActivities = pgTable("broker_activities", {
  id: uuid().defaultRandom().primaryKey(),
  firstImportId: uuid("first_import_id").notNull().references(() => statementImports.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  broker: text().notNull(),
  account: text().notNull(),
  sourceSection: text("source_section").notNull(),
  sourceId: text("source_id").notNull(),
  sourceLine: integer("source_line").notNull(),
  activity: jsonb().$type<Omit<Activity, "account" | "source">>().notNull(),
}, (table) => [
  unique("broker_activities_identity_key").on(table.userId, table.broker, table.account, table.sourceSection, table.sourceId),
  index("broker_activities_first_import_idx").on(table.firstImportId),
]);
