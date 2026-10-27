import { type NextRequest } from "next/server";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { dayRange } from "@/lib/time";
import { reportSnapshot } from "@/lib/reports";
import { safeCsvCell } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const { organization } = await requireWorkspace();
  const day = request.nextUrl.searchParams.get("day") || "";
  try { if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(); dayRange(day, organization.time_zone); }
  catch { return Response.json({ error: "Use a valid YYYY-MM-DD business date." }, { status: 400 }); }
  const data = await getDashboardData();
  if (data.truncated) return Response.json({ error: "Data limit reached. Export is disabled rather than silently incomplete." }, { status: 409 });
  const report = reportSnapshot(data.publications, data.comments, day, organization.time_zone);
  const names = new Map(data.customers.map((customer) => [customer.id, customer.name]));
  const rows: (string | number | null)[][] = [["business_date", "business_timezone", "generated_at_utc", "customer", "title", "url", "published_at_utc", "last_observed_visibility", "last_observed_at_utc", "comments_total", "publication_source"]];
  report.cohort.forEach((post) => rows.push([day, organization.time_zone, report.generatedAt, names.get(post.customer_id) || "Assigned customer", post.title, post.url, post.published_at, post.visibility, post.last_observed_at, post.comments_total, post.source]));
  return new Response("\uFEFF" + rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="nd-reporting-${day}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
