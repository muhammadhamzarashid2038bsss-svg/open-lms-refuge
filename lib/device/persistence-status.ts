// One look at browser storage persistence. persist() asks the browser to
// protect stored data from automatic eviction. It is asked at most once, and
// it is not asked again when the browser already agreed. A refusal, a failed
// request, or no answer does not mean IndexedDB cannot store attendance.
// The save path measures free space, writes the rows, and reads them back.
// The person can still clear the site, and the browser can still remove
// local records later. This display does not decide whether a mark is saved.

export type PersistenceRequest = "granted" | "denied" | "already-kept" | "unsupported" | "failed";

export type PersistenceSnapshot = {
  persisted: boolean | null;
  request: PersistenceRequest;
  usageBytes: number | null;
  quotaBytes: number | null;
};

export type PersistenceStorage = {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
};

function finiteByte(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function readPersistenceOnce(storage: PersistenceStorage | null): Promise<PersistenceSnapshot> {
  const snapshot: PersistenceSnapshot = {
    persisted: null,
    request: "unsupported",
    usageBytes: null,
    quotaBytes: null,
  };
  if (!storage) return snapshot;

  if (typeof storage.persisted === "function") {
    try {
      snapshot.persisted = await storage.persisted();
    } catch {
      snapshot.persisted = null;
    }
  }

  if (snapshot.persisted === true) {
    snapshot.request = "already-kept";
  } else if (typeof storage.persist === "function") {
    try {
      const granted = await storage.persist();
      snapshot.request = granted ? "granted" : "denied";
      if (granted) snapshot.persisted = true;
    } catch {
      snapshot.request = "failed";
    }
  }

  if (typeof storage.estimate === "function") {
    try {
      const estimate = await storage.estimate();
      if (finiteByte(estimate?.usage)) snapshot.usageBytes = estimate.usage;
      if (finiteByte(estimate?.quota)) snapshot.quotaBytes = estimate.quota;
    } catch {
      snapshot.usageBytes = null;
      snapshot.quotaBytes = null;
    }
  }

  return snapshot;
}

/// "Browser storage persistence" is the eviction promise, not proof that a
/// mark is in IndexedDB. The warning stays on every result because a granted
/// promise can still be cleared by the person or removed by the browser.
const EVICTION_WARNING = "The browser may still remove local records, and you can still clear this site's data.";

export function persistenceLines(snapshot: PersistenceSnapshot): string[] {
  const kept = snapshot.persisted === true ? "yes" : snapshot.persisted === false ? "no" : "unknown";
  const request =
    snapshot.request === "granted"
      ? "The browser has granted storage persistence."
      : snapshot.request === "already-kept"
        ? "Storage persistence is already active."
        : snapshot.request === "denied"
          ? "The browser did not grant protection against automatic removal. This does not itself prevent attendance from being stored."
          : snapshot.request === "failed"
            ? "The browser could not confirm storage persistence. This does not itself prevent attendance from being stored."
            : "Storage persistence cannot be confirmed. Whether attendance can be stored is checked separately.";
  const space =
    snapshot.usageBytes !== null && snapshot.quotaBytes !== null
      ? `Storage used: ${snapshot.usageBytes} bytes. Storage available to this site: ${snapshot.quotaBytes} bytes.`
      : "Storage space could not be read.";
  return [`Browser storage persistence: ${kept}.`, request, EVICTION_WARNING, space];
}
