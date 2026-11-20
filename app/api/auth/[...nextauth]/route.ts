import { authentication } from "@/server/auth";

export const runtime = "nodejs";

function unavailable() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const GET = authentication?.handlers.GET ?? unavailable;
export const POST = authentication?.handlers.POST ?? unavailable;
