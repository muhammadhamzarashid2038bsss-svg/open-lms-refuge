import { describe, expect, it } from "vitest";
import {
  compareVersionVectors,
  incrementDeviceCounter,
  isOwnIncrement,
  isSingleDeviceVector,
  mergeVersionVectors,
  parseVersionVector,
} from "../lib/sync/version-vector";

const phoneA = "00000000-0000-4000-8000-0000000000a1";
const phoneB = "00000000-0000-4000-8000-0000000000b2";

describe("version vectors", () => {
  it("detects dominance in both directions, equality, and concurrency", () => {
    const earlier = parseVersionVector({ [phoneA]: 1 });
    const later = parseVersionVector({ [phoneA]: 2 });
    const other = parseVersionVector({ [phoneB]: 1 });
    const both = parseVersionVector({ [phoneA]: 1, [phoneB]: 1 });
    if (!earlier || !later || !other || !both) throw new Error("vectors");
    expect(compareVersionVectors(later, earlier)).toBe("dominates");
    expect(compareVersionVectors(earlier, later)).toBe("dominated");
    expect(compareVersionVectors(earlier, { ...earlier })).toBe("equal");
    expect(compareVersionVectors(earlier, parseVersionVector({ [phoneA]: 1, [phoneB]: 0 })!)).toBe("equal");
    expect(compareVersionVectors(earlier, other)).toBe("concurrent");
    expect(compareVersionVectors(both, earlier)).toBe("dominates");
    expect(compareVersionVectors(other, both)).toBe("dominated");
  });

  it("does not read a phone clock", () => {
    const left = parseVersionVector({ [phoneA]: 2 });
    const right = parseVersionVector({ [phoneA]: 1 });
    if (!left || !right) throw new Error("vectors");
    expect(compareVersionVectors(left, right)).toBe("dominates");
    expect(compareVersionVectors.length).toBe(2);
  });

  it("rejects invalid vectors and counters", () => {
    expect(parseVersionVector(null)).toBeNull();
    expect(parseVersionVector([])).toBeNull();
    expect(parseVersionVector("1")).toBeNull();
    expect(parseVersionVector({ "not-a-device": 1 })).toBeNull();
    expect(parseVersionVector({ [phoneA]: -1 })).toBeNull();
    expect(parseVersionVector({ [phoneA]: 1.5 })).toBeNull();
    expect(parseVersionVector({ [phoneA]: "1" })).toBeNull();
    expect(parseVersionVector({ [phoneA]: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(parseVersionVector({ [phoneA.toUpperCase()]: 1, [phoneA]: 2 })).toBeNull();
    const crowded: Record<string, number> = {};
    for (let index = 0; index < 17; index += 1) crowded[`00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`] = 1;
    expect(parseVersionVector(crowded)).toBeNull();
  });

  it("merges by the highest count and increments only the resolving phone", () => {
    const left = parseVersionVector({ [phoneA]: 2, [phoneB]: 1 })!;
    const right = parseVersionVector({ [phoneA]: 1, [phoneB]: 4 })!;
    const merged = mergeVersionVectors(left, right);
    expect(merged).toEqual({ [phoneA]: 2, [phoneB]: 4 });
    expect(incrementDeviceCounter(merged, phoneA)).toEqual({ [phoneA]: 3, [phoneB]: 4 });
    expect(isOwnIncrement(merged, { [phoneA]: 3, [phoneB]: 4 }, phoneA)).toBe(true);
    expect(isOwnIncrement(merged, { [phoneA]: 3, [phoneB]: 5 }, phoneA)).toBe(false);
    expect(isSingleDeviceVector({ [phoneA]: 1 }, phoneA)).toBe(true);
    expect(isSingleDeviceVector(merged, phoneA)).toBe(false);
    expect(incrementDeviceCounter({}, "phone")).toBeNull();
  });
});
