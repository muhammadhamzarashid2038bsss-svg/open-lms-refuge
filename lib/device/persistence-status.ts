// One look at whether this phone will keep saved marks. persist() is asked
// at most once, and it is not asked again when the browser already agreed.
// A refusal leaves local attendance saving unavailable. There is no server fallback.

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

export function persistenceLines(snapshot: PersistenceSnapshot): string[] {
  const kept = snapshot.persisted === true ? "yes" : snapshot.persisted === false ? "no" : "unknown";
  const request =
    snapshot.request === "granted"
      ? "The browser agreed to keep saved data."
      : snapshot.request === "already-kept"
        ? "Saved data is already allowed to stay."
        : snapshot.request === "denied"
          ? "This phone did not allow saved data to stay. Local attendance saving is unavailable."
          : snapshot.request === "failed"
            ? "This phone could not say whether saved data may stay. Local attendance saving is unavailable."
            : "This phone cannot keep saved data. Local attendance saving is unavailable.";
  const space =
    snapshot.usageBytes !== null && snapshot.quotaBytes !== null
      ? `Storage used: ${snapshot.usageBytes} bytes. Storage available to this site: ${snapshot.quotaBytes} bytes.`
      : "Storage space could not be read.";
  return [`Kept on this phone: ${kept}.`, request, space];
}
