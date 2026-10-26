import { type NextRequest } from "next/server";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { EXPORT_SCOPES, exportRows, toCsv, type ExportScope } from "@/lib/sheet-export";
import { visibilityLabels } from "@/components/ui";
import { uuid } from "@/lib/validation";

// Staff see every post; customers only their own, because the data comes through Row Level Security.
export async function GET(request: NextRequest) {
  await requireWorkspace();
  const scopeParam = request.nextUrl.searchParams.get("scope") || "all";
  const customerParam = request.nextUrl.searchParams.get("customer") || "";
  if (!(EXPORT_SCOPES as readonly string[]).includes(scopeParam)) return Response.json({ error: "Unknown export scope." }, { status: 400 });
  if (customerParam && !uuid.safeParse(customerParam).success) return Response.json({ error: "Unknown customer." }, { status: 400 });

  const data = await getDashboardData();
  if (data.truncated) return Response.json({ error: "Data limit reached. Export is disabled rather than silently incomplete." }, { status: 409 });
  if (customerParam && !data.customers.some((customer) => customer.id === customerParam)) return Response.json({ error: "Unknown customer." }, { status: 404 });

  const names = new Map(data.customers.map((customer) => [customer.id, customer.name]));
  const rows = exportRows(data.publications, names, visibilityLabels, { scope: scopeParam as ExportScope, customerId: customerParam || undefined });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nd-posts-${scopeParam}-${day}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
