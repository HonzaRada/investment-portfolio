import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/router";

export const runtime = "nodejs";

function handle(req: Request) {
  const origin = req.headers.get("origin");
  if (req.method === "POST" && origin && origin !== new URL(process.env.AUTH_URL || req.url).origin) {
    return Response.json({ error: { message: "Požadavek musí přijít z této aplikace." } }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
    responseMeta: () => ({ headers: new Headers({ "Cache-Control": "private, no-store" }) }),
  });
}

export const GET = handle;
export const POST = handle;
