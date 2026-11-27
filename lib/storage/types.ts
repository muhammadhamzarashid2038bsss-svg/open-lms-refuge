import type { Readable } from "stream";

// Server-side object storage. Keys are private paths, never public URLs.
// A missing adapter means storage is unavailable. Callers must not invent a public stand-in.

export type PresignedPut = {
  url: string;
  expiresAt: string;
};

export type PresignedGet = {
  url: string;
  expiresAt: string;
};

export type StoredObjectHead = {
  byteSize: number;
  contentType: string | null;
};

export type StorageAdapter = {
  presignPut(input: { key: string; contentType: string; byteSize: number; expiresInSeconds: number }): Promise<PresignedPut>;
  presignGet(input: {
    key: string;
    expiresInSeconds: number;
    /// Optional download name. It is signed into the link and is not a storage key.
    contentDisposition?: string;
  }): Promise<PresignedGet>;
  head(key: string): Promise<StoredObjectHead | null>;
  open(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
};

export class StorageUnavailableError extends Error {
  constructor() {
    super("STORAGE_UNAVAILABLE");
    this.name = "StorageUnavailableError";
  }
}
