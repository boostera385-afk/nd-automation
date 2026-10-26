import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";
import { safeAuthNext } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeAuthNext(request.nextUrl.searchParams.get("next")), appUrl()));
  }
  return NextResponse.redirect(new URL("/login?notice=invalid-link", appUrl()));
}
