import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/data";
import { matchesWorkspaceContext } from "@/lib/workspace-selection";
import { isMissingSchemaError } from "@/lib/checks";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const unavailable = { available: false, items: [], lastSeenAt: null };

// Use the same verified identity and selected business as pages and mutations.
// Old tabs must not poll or acknowledge another business after a cookie switch.
export async function GET(request: NextRequest) {
  const { db, user, organization } = await getContext();
  if (!organization) return NextResponse.json(unavailable, { headers });
  if (!matchesWorkspaceContext(request.nextUrl.searchParams.get("workspaceContext"), user.id, organization.id)) {
    return NextResponse.json(unavailable, { status: 409, headers });
  }
  const [items, state] = await Promise.all([
    db.from("reporting_notifications").select("id,publication_id,kind,tone,title,message,check_count,created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(20),
    db.from("reporting_notification_state").select("last_seen_at").eq("organization_id", organization.id).eq("user_id", user.id).maybeSingle(),
  ]);
  if (items.error || state.error) {
    if (isMissingSchemaError(items.error ?? state.error)) return NextResponse.json(unavailable, { headers });
    return NextResponse.json(unavailable, { status: 502, headers });
  }
  return NextResponse.json({ available: true, items: items.data ?? [], lastSeenAt: state.data?.last_seen_at ?? null }, { headers });
}
