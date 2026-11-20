import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/router";

export const runtime = "nodejs";

export function POST(req: Request) {
  return fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext: () => ({}) });
}
