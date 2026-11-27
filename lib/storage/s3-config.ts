// Private homework files use an S3-compatible bucket. Backblaze B2 is the
// intended provider. These values stay on the server. NEXT_PUBLIC_ must not
// be used: that prefix would ship the secret to the browser.
//
// A missing or malformed setting makes storage unavailable. The phone then
// keeps the file. There is no public bucket to fall back to.

export const OBJECT_STORAGE_ENDPOINT = "OBJECT_STORAGE_ENDPOINT";
export const OBJECT_STORAGE_REGION = "OBJECT_STORAGE_REGION";
export const OBJECT_STORAGE_BUCKET = "OBJECT_STORAGE_BUCKET";
export const OBJECT_STORAGE_ACCESS_KEY_ID = "OBJECT_STORAGE_ACCESS_KEY_ID";
export const OBJECT_STORAGE_SECRET_ACCESS_KEY = "OBJECT_STORAGE_SECRET_ACCESS_KEY";

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function setting(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // A copied label or a line break is not a usable setting. The value is
  // not included in the failure, so a secret cannot leak through an error.
  if (/[\s\u0000]/.test(trimmed)) return null;
  return trimmed;
}

function validEndpoint(endpoint: string, region: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  if (url.hostname.length === 0 || url.hostname.includes("..")) return false;
  // Backblaze's S3 host is s3.<region>.backblazeb2.com. A copied region that
  // does not match that host would sign requests for the wrong place.
  const backblaze = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i.exec(url.hostname);
  if (backblaze && backblaze[1].toLowerCase() !== region) return false;
  return true;
}

function validRegion(region: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(region);
}

function validBucket(bucket: string): boolean {
  // A bucket name, not a URL or a folder path. Dots are rejected so the
  // signed host stays a single DNS label under the storage endpoint.
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
}

export function readObjectStorageConfig(
  env: Record<string, string | undefined> = process.env,
): ObjectStorageConfig | null {
  const endpoint = setting(env[OBJECT_STORAGE_ENDPOINT]);
  const region = setting(env[OBJECT_STORAGE_REGION]);
  const bucket = setting(env[OBJECT_STORAGE_BUCKET]);
  const accessKeyId = setting(env[OBJECT_STORAGE_ACCESS_KEY_ID]);
  const secretAccessKey = setting(env[OBJECT_STORAGE_SECRET_ACCESS_KEY]);
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!validRegion(region) || !validBucket(bucket) || !validEndpoint(endpoint, region)) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}
