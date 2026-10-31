export type AutomationKind = "profile_create" | "preset_snapshot" | "cookie_import" | "proxy_import";
export type AutomationStatus = "pending" | "leased" | "succeeded" | "failed" | "cancelled";

export type AutomationTask = {
  id: string;
  worker_id: string;
  kind: AutomationKind;
  status: AutomationStatus;
  summary: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  lease_expires_at: string | null;
};

export const automationKinds: AutomationKind[] = ["profile_create", "preset_snapshot", "cookie_import", "proxy_import"];

export const kindLabels: Record<AutomationKind, string> = {
  profile_create: "Create Incogniton profile",
  preset_snapshot: "Read preset inventory",
  cookie_import: "Check a local cookie file",
  proxy_import: "Check a local proxy file",
};

export const kindDescriptions: Record<AutomationKind, string> = {
  profile_create: "Asks the paired laptop to create one blank Incogniton profile. No proxy, cookie, password or account label is sent or stored here.",
  preset_snapshot: "Reads how many profiles and groups exist and how many are open. Counts only; no names, cookies or proxies are returned.",
  cookie_import: "Validates a Netscape cookies.txt file already on the worker machine. Counts entries and domains; never stores or uploads cookie values.",
  proxy_import: "Validates a host:port or host:port:user:pass list already on the worker machine. Reports counts; credentials are never returned.",
};

export const statusLabels: Record<AutomationStatus, string> = {
  pending: "Waiting for laptop",
  leased: "Running on laptop",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const statusTones: Record<AutomationStatus, "positive" | "negative" | "attention" | "neutral"> = {
  pending: "attention",
  leased: "attention",
  succeeded: "positive",
  failed: "negative",
  cancelled: "neutral",
};

export const operatingSystems = [
  { value: "windows", label: "Windows" },
  { value: "mac", label: "macOS" },
  { value: "linux", label: "Linux" },
];

export function isAutomationKind(value: unknown): value is AutomationKind {
  return typeof value === "string" && (automationKinds as string[]).includes(value);
}

export function validateProfileInput(input: { name: string; group: string; os: string }): string | null {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) return "Enter a profile name of 2–60 characters.";
  if (/[\u0000-\u001f]/.test(name)) return "The profile name contains control characters.";
  if (input.group.trim().length > 60) return "The group name must be 60 characters or fewer.";
  if (!operatingSystems.some((item) => item.value === input.os)) return "Choose Windows, macOS or Linux.";
  return null;
}

export function validateLocalPath(path: string): string | null {
  const value = path.trim();
  if (value.length < 3 || value.length > 400) return "Enter the absolute path of the file on the laptop.";
  const absolute = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
  if (!absolute) return "Use an absolute path, for example C:\\Exports\\cookies.txt.";
  if (value.split(/[\\/]/).includes("..")) return "The path must not traverse upwards.";
  return null;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** One honest sentence per outcome; never invents a value the worker did not report. */
export function describeResult(task: AutomationTask, workerName?: string): string {
  if (task.status === "pending") return "Waiting for the paired laptop to poll.";
  if (task.status === "leased") return `Running${workerName ? ` on ${workerName}` : ""}; the lease expires automatically.`;
  if (task.status === "cancelled") return "Cancelled before it ran.";
  if (task.status === "failed") return task.error ? `Failed: ${task.error}` : "Failed without a stored reason.";
  const result = task.result ?? {};
  if (task.kind === "profile_create") {
    const name = text(result.name);
    const id = text(result.profile_id);
    return id ? `Created ${name ?? "a profile"} (${id.slice(0, 8)}…).` : "The worker reported success without a profile id.";
  }
  if (task.kind === "preset_snapshot") {
    const profiles = number(result.profiles), groups = number(result.groups), launched = number(result.launched);
    if (profiles === null || groups === null) return "The worker reported success without counts.";
    return `${profiles} profile(s), ${groups} group(s)${launched === null ? "" : `, ${launched} open`}.`;
  }
  const entries = number(result.entries), credentials = number(result.with_credentials);
  const sample = Array.isArray(result.sample) ? result.sample.filter((item) => typeof item === "string").slice(0, 3) : [];
  if (entries === null) return "The worker reported success without a count.";
  const noun = task.kind === "cookie_import" ? "cookie(s)" : "proxy entry(ies)";
  return `${entries} ${noun}${credentials === null ? "" : `, ${credentials} with credentials`}${sample.length ? ` · ${sample.join(", ")}` : ""}.`;
}

/** Rows that stay out of the browser until their own gate is opened. */
export const gatedTasks = [
  { label: "Auto Posting", reason: "Publishing writes to a live Nextdoor account. The worker has no publish handler and the pilot account is suspended." },
  { label: "Auto Listing", reason: "Same live-publishing gate as Auto Posting; no listing handler exists in the worker." },
  { label: "ND Acc Creation", reason: "Account creation needs an authorized identity, human verification handoff and its own security review." },
  { label: "Content presets / warmup", reason: "Random engagement and unverified group selection need an explicit policy decision before any port." },
];
