import { redirect } from "next/navigation";

export default function Setup() {
  // Legacy development entrypoint. Infrastructure setup lives in docs, never in the customer UI.
  redirect("/login");
}
