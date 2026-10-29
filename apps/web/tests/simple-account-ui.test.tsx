import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), data: vi.fn(), operations: vi.fn() }));
vi.mock("@/lib/data", () => ({ getContext: mocks.context, getDashboardData: mocks.data }));
vi.mock("@/lib/operations-data", () => ({ getOperationsData: mocks.operations }));
vi.mock("@/lib/sheet-sync", () => ({ sheetSyncConfigured: vi.fn() }));
vi.mock("@/app/actions/reporting", () => ({ createWorkspace: vi.fn() }));
vi.mock("@/components/action-form", () => ({ ActionForm: ({ children, label }: { children: ReactNode; label: string }) => <form>{children}<button>{label}</button></form> }));
vi.mock("@/components/auth-screen", () => ({ AuthScreen: ({ description }: { description: string }) => <p>{description}</p> }));

import Home from "@/app/dashboard/page";
import Signup from "@/app/signup/page";

it("offers explicit private account setup without a workspace name form or automatic writes", async () => {
  mocks.context.mockResolvedValue({ organization: null, isStaff: false });
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain("Set up my private business account");
  expect(html).toContain('type="hidden" name="name" value="My business"');
  expect(html).not.toContain("Workspace name");
  expect(html).toContain("ask its owner for access");
  expect(mocks.operations).not.toHaveBeenCalled();
  expect(mocks.data).not.toHaveBeenCalled();
});

it("explains email verification and shared credentials instead of requiring a second signup", () => {
  const html = renderToStaticMarkup(<Signup />);
  expect(html).toContain("verify your email");
  expect(html).toContain("same email and password in Fudge and the ND dashboard");
});
