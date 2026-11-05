import { createHash } from "crypto";

// Demo centers may not have object storage wired up yet. Learners still need a
// small download to test authorization without exposing the private storage key.
export function syntheticFileBytes(checksumSha256: string | null, byteSize: number | null): Uint8Array {
  const seed = checksumSha256 ?? "synthetic-demo-file";
  const hash = createHash("sha256").update(seed).digest();
  const size = Math.min(Math.max(byteSize ?? 512, 64), 256 * 1024);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    out[i] = hash[i % hash.length]!;
  }
  return out;
}

export function downloadFilename(title: string, mimeType: string | null): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const safe = base || "resource";
  if (mimeType === "application/pdf") return `${safe}.pdf`;
  if (mimeType === "audio/mpeg") return `${safe}.mp3`;
  return safe;
}
