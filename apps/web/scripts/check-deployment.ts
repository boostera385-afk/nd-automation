import { checkDeployment } from "../src/lib/deployment-readiness.ts";

try {
  if (process.argv.length !== 3) throw new Error("Usage: npm run check:deployment -- https://your-deployment.example");
  const result = await checkDeployment(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.anonymousRouteChecksPassed ? 0 : 1;
} catch {
  console.error("Deployment check could not run. Supply one HTTPS origin (HTTP loopback is allowed for local tests), without credentials, path or query.");
  process.exitCode = 1;
}
