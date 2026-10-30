import { expect, it, vi } from "vitest";
import { checkDeployment, deploymentOrigin } from "@/lib/deployment-readiness";

const origin = "https://dashboard.example";
const good = (url: string | URL | Request) => new Response(null, { status: String(url).endsWith("/login") ? 200 : 307,
  headers: { "x-frame-options": "DENY", "cache-control": "private, no-store", ...(String(url).endsWith("/login") ? {} : { location: "/login" }) } });

it("checks current protected routes anonymously without treating a redirect as authenticated acceptance", async () => {
  const request = vi.fn(async (input: string | URL | Request) => good(input));
  expect(await checkDeployment(origin, request)).toMatchObject({ anonymousRouteChecksPassed: true, authenticatedReadiness: "unverified" });
  expect(request.mock.calls).toHaveLength(5);
  for (const [url] of request.mock.calls) expect(String(url).startsWith(origin + "/")).toBe(true);
});
it.each(["/workspaces", "/verify-email"])("fails when the deployed identity route %s is missing", async (path) => {
  const result = await checkDeployment(origin, async (url) => String(url).endsWith(path) ? new Response(null, { status: 404 }) : good(url));
  expect(result.anonymousRouteChecksPassed).toBe(false);
  expect(result.checks.find((check) => check.path === path)).toMatchObject({ status: 404, pass: false });
});
it("never follows or accepts an external login redirect", async () => {
  const request = vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://foreign.example/login", "x-frame-options": "DENY" } }));
  expect((await checkDeployment(origin, request)).anonymousRouteChecksPassed).toBe(false);
  for (const call of request.mock.calls) expect(call).toHaveLength(2);
  expect(request).toHaveBeenCalledWith(origin + "/workspaces", expect.objectContaining({ redirect: "manual", credentials: "omit", cache: "no-store" }));
});
it("fails closed on timeout/network errors and does not expose private exception text", async () => {
  const result = await checkDeployment(origin, async () => { throw new Error("PRIVATE_DETAILS"); });
  expect(result.anonymousRouteChecksPassed).toBe(false);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_DETAILS");
});
it("requires frame denial and an uncached login response", async () => {
  expect((await checkDeployment(origin, async (url) => new Response(null, { status: String(url).endsWith("/login") ? 200 : 307, headers: { location: "/login" } }))).anonymousRouteChecksPassed).toBe(false);
});
it.each(["http://remote.example", "https://user:pass@dashboard.example", "https://dashboard.example/path", "https://dashboard.example?secret=private", "https://dashboard.example#fragment"])("rejects unsafe deployment origin %s before network access", async (value) => {
  const request = vi.fn();
  await expect(checkDeployment(value, request)).rejects.toThrow();
  request.mock.calls.forEach(() => { throw new Error("Unexpected request"); });
});
it("allows explicit loopback testing without reading environment or secrets", () => {
  expect(deploymentOrigin("http://127.0.0.1:3107")).toBe("http://127.0.0.1:3107");
});
