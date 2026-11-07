import { describe, expect, it } from "vitest";
import { checkStorageReadiness, claimForStorage, type StorageProbe } from "../lib/device/storage-readiness";

function probe(persist: StorageProbe["persist"], estimate: StorageProbe["estimate"]): StorageProbe {
  return { persist, estimate };
}

describe("browser storage readiness", () => {
  it("reports an unsupported storage API without claiming a mark was saved", async () => {
    const readiness = await checkStorageReadiness(100, null);
    expect(readiness.persistence).toBe("unsupported");
    expect(readiness.estimate).toBe("unavailable");
    expect(readiness.readyForWrite).toBe(false);
    expect(readiness.mayClaimSaved).toBe(false);
    expect(readiness.evictionStillPossible).toBe(true);
    expect(claimForStorage(readiness).confirmed).toBe(false);
  });

  it("allows a claim only when persistence is granted and the estimate has room", async () => {
    const granted = await checkStorageReadiness(
      100,
      probe(
        async () => true,
        async () => ({ quota: 1000, usage: 200 }),
      ),
    );
    expect(granted.persistence).toBe("granted");
    expect(granted.availableBytes).toBe(800);
    expect(granted.enoughRoom).toBe(true);
    expect(granted.readyForWrite).toBe(true);
    expect(granted.mayClaimSaved).toBe(true);
    expect(granted.evictionStillPossible).toBe(true);
    expect(claimForStorage(granted).message).toBe("Saved on this phone, waiting to send");
  });

  it("does not claim a save when persistence is denied, even with room", async () => {
    const denied = await checkStorageReadiness(
      100,
      probe(
        async () => false,
        async () => ({ quota: 1000, usage: 0 }),
      ),
    );
    expect(denied.persistence).toBe("denied");
    expect(denied.readyForWrite).toBe(true);
    expect(denied.mayClaimSaved).toBe(false);
    expect(claimForStorage(denied)).toMatchObject({ confirmed: false, deleteExisting: false });
  });

  it("does not claim a save when the estimate fails or there is too little room", async () => {
    const failed = await checkStorageReadiness(
      100,
      probe(
        async () => true,
        async () => {
          throw new Error("estimate failed");
        },
      ),
    );
    expect(failed.estimate).toBe("failed");
    expect(failed.mayClaimSaved).toBe(false);

    const missing = await checkStorageReadiness(
      100,
      probe(async () => true, async () => ({})),
    );
    expect(missing.estimate).toBe("unavailable");
    expect(missing.mayClaimSaved).toBe(false);

    const full = await checkStorageReadiness(
      100,
      probe(
        async () => true,
        async () => ({ quota: 150, usage: 80 }),
      ),
    );
    expect(full.availableBytes).toBe(70);
    expect(full.enoughRoom).toBe(false);
    expect(full.readyForWrite).toBe(false);
    expect(full.mayClaimSaved).toBe(false);
    expect(claimForStorage(full).confirmed).toBe(false);
  });

  it("records a failed persistence request and rejects a bad size", async () => {
    const failed = await checkStorageReadiness(
      10,
      probe(
        async () => {
          throw new Error("persist failed");
        },
        async () => ({ quota: 100, usage: 0 }),
      ),
    );
    expect(failed.persistence).toBe("failed");
    expect(failed.readyForWrite).toBe(true);
    expect(failed.mayClaimSaved).toBe(false);

    const badSize = await checkStorageReadiness(
      1.5,
      probe(
        async () => true,
        async () => ({ quota: 100, usage: 0 }),
      ),
    );
    expect(badSize.enoughRoom).toBe(false);
    expect(badSize.mayClaimSaved).toBe(false);
  });
});
