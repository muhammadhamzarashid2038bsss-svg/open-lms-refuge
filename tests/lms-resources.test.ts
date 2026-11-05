import { describe, expect, it } from "vitest";
import { countDownloadableResources, validateResourcePayload } from "../lib/lms/resources";

describe("resource helpers", () => {
  it("counts only private PDF and audio files", () => {
    const count = countDownloadableResources([
      { resourceType: "PDF", fileStatus: "private" },
      { resourceType: "AUDIO", fileStatus: "private" },
      { resourceType: "TEXT", fileStatus: "none" },
      { resourceType: "PDF", fileStatus: "none" },
    ]);
    expect(count).toBe(2);
  });

  it("requires https links and reading-list text", () => {
    expect(validateResourcePayload({ resourceType: "WEB_LINK", externalUrl: "http://bad" }).ok).toBe(false);
    expect(validateResourcePayload({ resourceType: "WEB_LINK", externalUrl: "https://example.com" }).ok).toBe(true);
    expect(validateResourcePayload({ resourceType: "TEXT", bodyText: "short" }).ok).toBe(false);
    expect(
      validateResourcePayload({ resourceType: "TEXT", bodyText: "Week 1: letters A to C and numbers 1 to 5." }).ok,
    ).toBe(true);
  });
});
