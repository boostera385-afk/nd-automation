import { readFile, mkdir, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../../../integrations/sheets/reporting-sync.gs", import.meta.url), "utf8");
const directory = new URL("../src/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("sheet-connector.ts", directory), `// Generated from integrations/sheets/reporting-sync.gs. Do not edit by hand.\nexport const SHEET_CONNECTOR_SOURCE = ${JSON.stringify(source)};\n`);
console.log("Bundled the generic read-only Sheet connector (no connection secrets).");
