import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import { getDb } from "./db";
import { authAccounts, sessions, users } from "./db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const authentication = process.env.DATABASE_URL && process.env.AUTH_URL && process.env.AUTH_SECRET &&
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
  ? NextAuth({
    adapter: DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: authAccounts,
      sessionsTable: sessions,
    }),
    providers: [GitHub({ account: () => ({}) })],
    session: { strategy: "database" },
    callbacks: {
      session({ session, user }) {
        const { id, name, email, image } = user;
        return { expires: session.expires, user: { id, name, email, image } };
      },
    },
  })
  : null;
