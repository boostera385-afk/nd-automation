import Link from "next/link";

export function EmployeeComputerGuide() {
  return <section className="notice subtle">
    <h2>Your administrator sets up the laptop once</h2>
    <p>Use your own confirmed email. Your administrator adds that email to the workspace, prepares customers and profile mappings, and gives this laptop its own private helper connection.</p>
    <p>On your Windows laptop, your administrator can help run <strong>Setup Employee Computer.bat</strong> once. Python 3.13 with Tkinter and Incogniton must already be installed. This file connects the launcher and pairs the private connection; it does not install software or copy browser profiles.</p>
    <ol><li>Sign in and open Incogniton using its authorized account.</li><li>Click <strong>Start profile helper</strong> and approve the local prompt. Leave the console open.</li><li>Click <strong>Start work</strong>, then <Link href="/dashboard/run">Run automation</Link>. Use only the helper your administrator identified for this laptop.</li><li>Review <Link href="/dashboard/results">Results</Link>, then <strong>End work</strong>. Stop the helper when its task is finished.</li></ol>
    <p>No daily registration, profile import or customer mapping. If setup is missing or the helper closes, contact your administrator; do not register extra helpers or delete recovery files.</p>
    <p>Shared dashboard profiles are inventory claims, not local browser access. Incogniton on this laptop must separately have access to the exact profile. Heartbeats do not prove that access.</p>
  </section>;
}
