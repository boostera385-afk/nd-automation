/** Whitelisted public build identity only; never spread environment settings. */
export function publicRelease(input: { version?: string; environment?: string; deploymentId?: string; deploymentHost?: string }) {
  const version = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,40})?$/.test(input.version ?? "") ? input.version! : "unknown";
  const environment = ["production", "preview", "development"].includes(input.environment ?? "") ? input.environment! : "unidentified host";
  const id = /^dpl_[A-Za-z0-9]{8,64}$/.test(input.deploymentId ?? "") ? input.deploymentId! : null;
  const host = input.deploymentHost ?? "";
  const validHost = host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/.test(host);
  return { version, environment, deployment: id ?? (validHost ? host : null) };
}
