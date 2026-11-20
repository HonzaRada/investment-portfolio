import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { ImportError, previewIbkr } from "@/lib/ibkr";
import { maxStatementBytes } from "@/lib/import-types";

const t = initTRPC.create();

export const appRouter = t.router({
  previewStatement: t.procedure
    .input(z.object({ xml: z.string().min(1).max(maxStatementBytes) }))
    .mutation(({ input }) => {
      try {
        return previewIbkr(input.xml);
      } catch (error) {
        if (!(error instanceof ImportError)) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
    }),
});

export type AppRouter = typeof appRouter;
