import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { publicRelease } from "@/lib/release-info";
import { ReleaseBadge } from "@/components/release-badge";

afterEach(() => vi.unstubAllEnvs());

it("shows the actual public Vercel deployment identity without inferring live readiness", () => {
  expect(publicRelease({ version: "0.1.1", environment: "production", deploymentId: "dpl_fixture123456" }))
    .toEqual({ version: "0.1.1", environment: "production", deployment: "dpl_fixture123456" });
});
it("falls back to the generated public deployment hostname", () => {
  expect(publicRelease({ version: "0.1.1", deploymentHost: "nd-fixture-build.vercel.app" }).deployment).toBe("nd-fixture-build.vercel.app");
});
it("labels unknown/local host metadata honestly rather than guessing a deployed version", () => {
  expect(publicRelease({})).toEqual({ version: "unknown", environment: "unidentified host", deployment: null });
});
it("does not echo credentials, arbitrary URLs, malformed metadata or unknown environment values", () => {
  const release = publicRelease({ version: "private-fixture-key", environment: "secret-production", deploymentId: "sb_secret_fixture", deploymentHost: "https://user:pass@example.test" });
  expect(release).toEqual({ version: "unknown", environment: "unidentified host", deployment: null });
});
it("renders release and deployment details in the frontend while excluding unrelated secrets", () => {
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_fixture123456");
  vi.stubEnv("PRIVATE_FIXTURE_TOKEN", "do-not-render-this");
  const html = renderToStaticMarkup(<ReleaseBadge />);
  expect(html).toContain("nd v0.1.4"); expect(html).toContain("production");
  expect(html).toContain("dpl_fixture123456");
  expect(html).toContain("not a live automation health check");
  expect(html).not.toContain("do-not-render-this");
});
