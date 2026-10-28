import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import baseline from "./fixtures/hosted-baseline-20261028.json";

describe("historical hosted migration baseline (offline, not live acceptance)", () => {
  it("records the selected project and explicitly maps hosted versions to source filenames", () => {
    expect(baseline.projectRef).toBe("xtefjnfdjnxwrpkoydaj");
    expect(baseline.migrations).toHaveLength(6);
    expect(new Set(baseline.migrations.map((entry) => entry.version)).size).toBe(6);
    expect(new Set(baseline.migrations.map((entry) => entry.source)).size).toBe(6);
  });

  it("preserves all 29 applied function bodies; changes belong in follow-up migrations", async () => {
    const actual: Record<string, string> = {};
    for (const migration of baseline.migrations) {
      const sql = await readFile(new URL(`../../../supabase/migrations/${migration.source}`, import.meta.url), "utf8");
      // Limited to this baseline's named, non-overloaded $$ function definitions.
      // A future syntax change must update this checker explicitly, not skip bodies.
      const definitions = sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_]+)\s*\([^$]*?\bas\s*\$\$([\s\S]*?)\$\$/gi);
      for (const [, name, body] of definitions) {
        expect(actual[name], `duplicate baseline function ${name}`).toBeUndefined();
        actual[name] = createHash("md5").update(body.trim().replace(/\r/g, "")).digest("hex");
      }
    }
    expect(Object.keys(actual)).toHaveLength(29);
    expect(actual).toEqual(baseline.functionBodies);
  });

  it("does not imply the local publishing protocol is deployed", () => {
    expect(baseline.migrations.some((entry) => entry.source.includes("publish_jobs"))).toBe(false);
    expect(Object.keys(baseline.functionBodies).some((name) => name.includes("claim_publish"))).toBe(false);
  });
});
