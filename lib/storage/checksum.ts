import { createHash, timingSafeEqual } from "crypto";
import { Readable } from "stream";

const PREFIX_BYTES = 16;

export type StreamFingerprint = {
  checksumSha256: string;
  byteSize: number;
  prefix: Uint8Array;
  complete: boolean;
};

// Hashes the object as it arrives. The whole file is not collected in memory.
// Reading stops once the file is past the 1 MB pilot cap.
export async function fingerprintStream(stream: Readable, maxBytes: number): Promise<StreamFingerprint> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const prefixParts: Buffer[] = [];
  let prefixLength = 0;
  let complete = true;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (prefixLength < PREFIX_BYTES) {
        prefixParts.push(bytes.subarray(0, PREFIX_BYTES - prefixLength));
        prefixLength += bytes.length;
      }
      const room = maxBytes + 1 - byteSize;
      if (bytes.length > room) {
        hash.update(bytes.subarray(0, Math.max(room, 0)));
        byteSize += Math.max(room, 0);
        complete = false;
        stream.destroy();
        break;
      }
      hash.update(bytes);
      byteSize += bytes.length;
    }
  } catch (error) {
    if (complete) throw error;
  }
  return {
    checksumSha256: hash.digest("hex"),
    byteSize,
    prefix: new Uint8Array(Buffer.concat(prefixParts).subarray(0, PREFIX_BYTES)),
    complete,
  };
}

export function sameSha256(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
