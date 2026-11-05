import type { ResourceType } from "../../generated/prisma/client";

export const RESOURCE_TYPES = [
  "PDF",
  "TEXT",
  "TEXTBOOK_LINK",
  "AUDIO",
  "VIDEO_LINK",
  "WEB_LINK",
] as const satisfies readonly ResourceType[];

export type ResourceTypeName = (typeof RESOURCE_TYPES)[number];

const LINK_TYPES = new Set<ResourceTypeName>(["TEXTBOOK_LINK", "VIDEO_LINK", "WEB_LINK"]);
const FILE_TYPES = new Set<ResourceTypeName>(["PDF", "AUDIO"]);

export function resourceTypeLabel(type: string): string {
  switch (type) {
    case "PDF":
      return "PDF file";
    case "TEXT":
      return "Reading list";
    case "TEXTBOOK_LINK":
      return "Textbook link";
    case "AUDIO":
      return "Audio file";
    case "VIDEO_LINK":
      return "Video link";
    case "WEB_LINK":
      return "Web link";
    default:
      return type;
  }
}

export function isDownloadableResource(type: string, hasPrivateFile: boolean): boolean {
  return hasPrivateFile && (type === "PDF" || type === "AUDIO");
}

export function countDownloadableResources(
  resources: { resourceType: string; fileStatus: "none" | "private" }[],
): number {
  return resources.filter((row) => isDownloadableResource(row.resourceType, row.fileStatus === "private")).length;
}

export type ResourcePayloadInput = {
  resourceType: ResourceTypeName;
  externalUrl?: string | null;
  bodyText?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  checksumSha256?: string | null;
};

export function validateResourcePayload(input: ResourcePayloadInput): { ok: true } | { ok: false; message: string } {
  const { resourceType } = input;
  if (!RESOURCE_TYPES.includes(resourceType)) {
    return { ok: false, message: "Pick a resource type from the list." };
  }
  if (LINK_TYPES.has(resourceType)) {
    const url = (input.externalUrl ?? "").trim();
    if (!url.startsWith("https://")) {
      return { ok: false, message: "Links must start with https:// so phones stay safe." };
    }
    return { ok: true };
  }
  if (resourceType === "TEXT") {
    const text = (input.bodyText ?? "").trim();
    if (text.length < 8) {
      return { ok: false, message: "Reading-list text needs at least a few words." };
    }
    if (text.length > 4000) {
      return { ok: false, message: "Reading-list text is too long. Split it into two entries." };
    }
    return { ok: true };
  }
  if (FILE_TYPES.has(resourceType)) {
    const key = (input.storageKey ?? "").trim();
    if (!key.startsWith("private/") || key.includes("://")) {
      return {
        ok: false,
        message: "File resources need a private storage key from the office upload step.",
      };
    }
    if (!(input.mimeType ?? "").trim()) {
      return { ok: false, message: "File resources need a MIME type (for example application/pdf)." };
    }
    if (!input.byteSize || input.byteSize < 1) {
      return { ok: false, message: "File resources need a byte size." };
    }
    if (!(input.checksumSha256 ?? "").trim()) {
      return { ok: false, message: "File resources need a checksum from the upload step." };
    }
    return { ok: true };
  }
  return { ok: false, message: "Unknown resource type." };
}

export function semesterLabel(semester: string): string {
  return semester === "SEMESTER_2" ? "Semester 2" : "Semester 1";
}
