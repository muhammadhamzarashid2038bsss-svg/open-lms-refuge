// Browser-native photo shrinking. A missing canvas or a photo the browser
// cannot decode returns null so the caller can keep a small original or refuse
// a file that is over the limit.

import type { ImageCodec } from "@/lib/lms/photo-prepare";

function blobFrom(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return new Blob([copy], { type: mime });
}

function hasAlpha(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return true;
  }
  for (let index = 3; index < pixels.length; index += 64) {
    if ((pixels[index] ?? 255) < 250) return true;
  }
  return false;
}

export function browserImageCodec(): ImageCodec | null {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  return {
    async decode(bytes, mime) {
      const bitmap = await createImageBitmap(blobFrom(bytes, mime));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, bitmap.width);
        canvas.height = Math.max(1, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        return { hasAlpha: mime !== "image/jpeg" && hasAlpha(canvas) };
      } finally {
        bitmap.close();
      }
    },
    async encode({ bytes, mime, quality, scale }) {
      const bitmap = await createImageBitmap(blobFrom(bytes, mime));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
        if (!blob) return null;
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        bitmap.close();
      }
    },
  };
}

export function codecOrUnavailable(): ImageCodec {
  return (
    browserImageCodec() ?? {
      async decode() {
        return null;
      },
      async encode() {
        return null;
      },
    }
  );
}
