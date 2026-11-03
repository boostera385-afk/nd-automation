import { expect, it } from "vitest";
import { assertSetupAdmin, canManageSetup } from "@/lib/setup-access";

it("only permits setup for explicit owner/admin roles", () => {
  for (const role of ["owner", "admin"]) {
    expect(canManageSetup(role)).toBe(true);
    expect(() => assertSetupAdmin({ role })).not.toThrow();
  }
  for (const role of ["operator", "customer", "OWNER", "", undefined]) {
    expect(canManageSetup(role)).toBe(false);
    expect(() => assertSetupAdmin(role === undefined ? undefined : { role })).toThrow("Only a workspace owner or admin");
  }
});
