"use client";

import { DEVICE_STORAGE_KEY } from "./storage-key";

// The backup is frozen after the IndexedDB copy is verified. This file only
// reads it. Writing here would change the checked text and make the next
// open look like a damaged phone. An older tab can still write. The queue
// check compares the text and stops when it has changed.

export function readDeviceBackup(): string | null {
  return localStorage.getItem(DEVICE_STORAGE_KEY);
}

/// Fires when another tab writes the backup. The `storage` event does not
/// fire in the tab that wrote the value, so this tab also re-reads on open.
export function watchDeviceBackup(onChanged: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === DEVICE_STORAGE_KEY) onChanged();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
