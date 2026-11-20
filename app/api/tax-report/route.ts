import { taxCsv, taxYear } from "@/lib/tax-report";
import { getTaxReport } from "@/server/tax-report";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const year = taxYear(new URL(request.url).searchParams.get("year"));
  if (!year) return new Response("Neplatný rok.", { status: 400, headers });

  const { report } = await getTaxReport(year);
  return new Response(taxCsv(report), { headers: {
    ...headers,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="danove-podklady-${year}.csv"`,
  } });
}
