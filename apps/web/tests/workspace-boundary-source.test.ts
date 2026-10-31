import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps all form-based business action entrypoints on the stale-context guard", () => {
  const modules = ["check-cohort", "checks", "content", "profiles", "publishing", "reporting", "service-catalog", "sheet-sync", "sheet-writeback", "workers", "workflow"];
  let guarded = 0;
  for (const name of modules) {
    const source = readFileSync(new URL(`../src/app/actions/${name}.ts`, import.meta.url), "utf8");
    const calls = [...source.matchAll(/await requireWorkspace\(([^)]*)\)/g)];
    for (const call of calls) expect(call[1], `${name} form action must validate rendered workspace context`).toBe("true, form");
    guarded += calls.length;
  }
  expect(guarded).toBe(32);
});

it("keeps custom mutation forms on the same provider-rendered context as shared forms", () => {
  const modules = ["action-form", "cohort-refresh", "check-queue", "monitoring-batch", "profile-import", "reporting-forms", "scan-import", "service-catalog-review", "service-catalog-stage", "sheet-sync-panel", "sheet-writeback-queue", "worker-registration"];
  for (const name of modules) {
    const source = readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
    expect(source).toContain("<WorkspaceField />");
    const forms = source.match(/<form action=/g) ?? [];
    const fields = source.match(/<WorkspaceField \/>/g) ?? [];
    expect(fields.length, `${name} form context fields`).toBe(forms.length);
  }
});
