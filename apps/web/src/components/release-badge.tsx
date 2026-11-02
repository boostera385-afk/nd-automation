import packageInfo from "../../package.json";
import { publicRelease } from "@/lib/release-info";

export function ReleaseBadge() {
  const release = publicRelease({ version: packageInfo.version, environment: process.env.VERCEL_ENV,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID, deploymentHost: process.env.VERCEL_URL });
  return <details className="release-badge">
    <summary>nd v{release.version} · {release.environment}</summary>
    <p>deployment: <code>{release.deployment ?? "not exposed by this host"}</code></p>
    <p>build identity only — not a live automation health check.</p>
  </details>;
}
