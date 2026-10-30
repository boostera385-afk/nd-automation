export function deploymentOrigin(value: string): string {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("Supply an HTTPS deployment origin only, or HTTP loopback for local testing.");
  }
  return url.origin;
}

/** Anonymous GETs only. Redirects are inspected, never followed; no Auth or data writes. */
export async function checkDeployment(value: string, request: typeof fetch = fetch) {
  const origin = deploymentOrigin(value);
  const paths = ["/login", "/workspaces", "/verify-email", "/dashboard", "/dashboard/run/cohorts"];
  const checks = await Promise.all(paths.map(async (path) => {
    try {
      const response = await request(origin + path, { redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const location = response.headers.get("location");
      const target = location ? new URL(location, origin) : null;
      const statusMatches = path === "/login" ? response.status === 200
        : response.status === 307 && target?.origin === origin && target.pathname === "/login" && !target.search && !target.hash;
      const frameDenied = response.headers.get("x-frame-options")?.toUpperCase() === "DENY";
      const loginUncached = path !== "/login" || /\bno-store\b/i.test(response.headers.get("cache-control") ?? "");
      await response.body?.cancel();
      return { path, status: response.status, pass: statusMatches && frameDenied && loginUncached };
    } catch {
      return { path, status: null, pass: false };
    }
  }));
  return { anonymousRouteChecksPassed: checks.every((check) => check.pass), authenticatedReadiness: "unverified" as const, checks };
}
