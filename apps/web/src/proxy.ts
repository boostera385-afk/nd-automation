import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicConfig } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const config = publicConfig();
  if (!config) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values, headers) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  // Validate the token rather than trusting a browser-provided session object.
  const { data } = await supabase.auth.getClaims();
  // A signed-in visitor has no reason to see these forms. /reset-password is excluded: a recovery link signs the user in first.
  if (data?.claims && ["/login", "/signup", "/forgot-password"].includes(request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/dashboard";
    target.search = "";
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  if ((request.nextUrl.pathname.startsWith("/dashboard") || ["/workspaces", "/verify-email"].includes(request.nextUrl.pathname)) && !data?.claims) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/dashboard/:path*", "/workspaces", "/verify-email", "/login", "/signup", "/forgot-password", "/reset-password"] };
