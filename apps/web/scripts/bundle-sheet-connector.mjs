import { readFile, mkdir, writeFile } from "node:fs/promises";

// The Apps Script source lives once, at the monorepo root. Locally the build runs
// from apps/web inside that monorepo, so the relative path resolves. Hosted builds
// (for example Vercel with apps/web as the project root) upload only this directory,
// so the monorepo source is absent there and the committed generated artifact is used
// instead. Both paths carry no connection secrets.
const source = new URL("../../../integrations/sheets/reporting-sync.gs", import.meta.url);
const directory = new URL("../src/generated/", import.meta.url);
const target = new URL("sheet-connector.ts", directory);

async function readMonorepoSource() {
  try {
    return await readFile(source, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertCommittedArtifact() {
  try {
    await readFile(target, "utf8");
  } catch {
    throw new Error("Sheet connector source and generated artifact are both missing; cannot build.");
  }
  console.log("Monorepo connector source is outside this build root; using the committed generated connector (no connection secrets).");
}

const content = await readMonorepoSource();
if (content === null) {
  await assertCommittedArtifact();
} else {
  await mkdir(directory, { recursive: true });
  await writeFile(target, `// Generated from integrations/sheets/reporting-sync.gs. Do not edit by hand.\nexport const SHEET_CONNECTOR_SOURCE = ${JSON.stringify(content)};\n`);
  console.log("Bundled the generic read-only Sheet connector (no connection secrets).");
}
