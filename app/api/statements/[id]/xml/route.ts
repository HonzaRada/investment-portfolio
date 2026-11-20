import { z } from "zod";
import { authentication } from "@/server/auth";
import { readStatementXml } from "@/server/statement-store";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await authentication?.auth();
  if (!session?.user.id) return new Response(null, { status: 401, headers: privateHeaders });

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404, headers: privateHeaders });

  try {
    const xml = await readStatementXml(session.user.id, id.data);
    if (xml === null) return new Response(null, { status: 404, headers: privateHeaders });
    return new Response(xml, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="ibkr-${id.data}.xml"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 500, headers: privateHeaders });
  }
}
