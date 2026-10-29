"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceAccess } from "@/lib/data";
import { WORKSPACE_COOKIE, workspaceContext } from "@/lib/workspace-selection";
import type { FormState } from "./auth";

export async function selectWorkspace(_previous: FormState, form: FormData): Promise<FormState> {
  const { user, memberships } = await getWorkspaceAccess();
  // The rendered actor prevents an old account's selection form from being used
  // after sign-in as another member of the same business. No client role is trusted.
  const org = z.uuid().safeParse(form.get("workspace"));
  if (form.getAll("actor").length !== 1 || form.get("actor") !== user.id
    || form.getAll("workspace").length !== 1 || !org.success
    || !memberships.some((row) => row.organization_id === org.data)) {
    return { error: "Workspace access changed or could not be verified. Reload the list and choose an authorized business." };
  }
  if (form.get("confirmed") !== "on") return { error: "Confirm the business you intend to open. No automation starts." };
  (await cookies()).set(WORKSPACE_COOKIE, workspaceContext(user.id, org.data), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
  });
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
