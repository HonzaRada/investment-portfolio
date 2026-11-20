import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { ImportError, previewIbkr } from "@/lib/ibkr";
import { maxStatementBytes } from "@/lib/import-types";
import { authentication } from "./auth";
import { ActivityConflict, listStatements, readStatement, saveStatement } from "./statement-store";

const t = initTRPC.create();
const xmlInput = z.string().min(1).max(maxStatementBytes);
const authenticated = t.procedure.use(async ({ next }) => {
  const session = await authentication?.auth();
  const userId = session?.user.id;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Přihlas se pro přístup k uloženým výpisům." });
  return next({ ctx: { userId } });
});

async function statementOperation<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ImportError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    if (error instanceof ActivityConflict) throw new TRPCError({ code: "CONFLICT", message: error.message });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "S výpisem se teď nepodařilo pracovat. Zkus to znovu." });
  }
}

export const appRouter = t.router({
  previewStatement: t.procedure.input(z.object({ xml: xmlInput }))
    .mutation(({ input }) => statementOperation(() => previewIbkr(input.xml))),
  saveStatement: authenticated.input(z.object({
    xml: xmlInput,
    filename: z.string().trim().min(1).max(255).refine((value) => !value.includes("\0"), "Neplatný název souboru."),
  })).mutation(({ ctx, input }) => statementOperation(() => saveStatement(ctx.userId, input.filename, input.xml))),
  getStatement: authenticated.input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => statementOperation(async () => {
      const result = await readStatement(ctx.userId, input.id);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Výpis nebyl nalezen." });
      return result;
    })),
  listStatements: authenticated.input(z.object({
    olderThan: z.object({ id: z.uuid(), savedAt: z.iso.datetime() }).optional(),
  })).query(({ ctx, input }) => statementOperation(() => listStatements(ctx.userId, input.olderThan))),
});

export type AppRouter = typeof appRouter;
