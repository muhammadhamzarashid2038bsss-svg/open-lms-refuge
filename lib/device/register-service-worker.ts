// Registration is a production concern. The development server must keep
// serving pages directly, so a broken or stale worker cannot hide a bug.

const SERVICE_WORKER_URL = "/sw.js";
const SERVICE_WORKER_SCOPE = "/";

type ServiceWorkerContainerLike = {
  register: (url: string, options: { scope: string }) => Promise<unknown>;
};

export function shouldRegisterServiceWorker(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

export async function registerKioskServiceWorker(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  container: { serviceWorker?: ServiceWorkerContainerLike } | null = typeof navigator === "undefined" ? null : navigator,
): Promise<"skipped" | "registered" | "unsupported" | "failed"> {
  if (!shouldRegisterServiceWorker(nodeEnv)) return "skipped";
  const registration = container?.serviceWorker;
  if (!registration || typeof registration.register !== "function") return "unsupported";
  try {
    await registration.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE });
    return "registered";
  } catch {
    // The online class still loads. A missing worker only removes the offline copy.
    return "failed";
  }
}
