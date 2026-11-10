// Private homework files live in Cloudflare R2. These values stay on the server.
// NEXT_PUBLIC_ must not be used: that prefix would ship the secret to the browser.

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: "auto";
  endpoint: string;
};

function filled(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readR2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = filled(env.R2_ACCOUNT_ID);
  const accessKeyId = filled(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = filled(env.R2_SECRET_ACCESS_KEY);
  const bucket = filled(env.R2_BUCKET_NAME);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}
