import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicConfig } from "@/lib/env";
import { isMissingSchemaError } from "@/lib/checks";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const unavailable = { available: false, items: [], lastSeenAt: null };

// Polled by the bell. Row Level Security decides what each person may see; this adds no extra access.
export async function GET() {
  if (!publicConfig()) return NextResponse.json(unavailable, { status: 503, headers });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const membership = await db.from("reporting_memberships").select("organization_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (membership.error || !membership.data) return NextResponse.json(unavailable, { headers });
  const org = membership.data.organization_id as string;

  const [items, state] = await Promise.all([
    db.from("reporting_notifications").select("id,publication_id,kind,tone,title,message,check_count,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(20),
    db.from("reporting_notification_state").select("last_seen_at").eq("organization_id", org).eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (items.error) {
    if (isMissingSchemaError(items.error)) return NextResponse.json(unavailable, { headers });
    return NextResponse.json({ available: true, items: [], lastSeenAt: null, error: "temporarily_unavailable" }, { status: 502, headers });
  }
  return NextResponse.json({ available: true, items: items.data ?? [], lastSeenAt: state.data?.last_seen_at ?? null }, { headers });
}
