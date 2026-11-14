import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { syncDatabaseFailureLabel } from "../lib/data/sync-records";

const noteText = "Day12 note body must stay off the log";

describe("unclassified sync database errors", () => {
  it("keeps a Prisma code and drops the message", () => {
    const error = new Prisma.PrismaClientKnownRequestError(`${noteText} SELECT secret`, {
      code: "P2028",
      clientVersion: "0.0.0",
    });
    const label = syncDatabaseFailureLabel(error);
    expect(label).toBe("P2028");
    expect(label).not.toContain(noteText);
    expect(label).not.toContain("SELECT");
  });

  it("uses a plain error name when Prisma did not assign a code", () => {
    const error = new TypeError(noteText);
    expect(syncDatabaseFailureLabel(error)).toBe("TypeError");
  });

  it("does not accept an error name that could carry note text", () => {
    const error = new Error(noteText);
    error.name = "note body";
    expect(syncDatabaseFailureLabel(error)).toBe("Error");
  });
});
