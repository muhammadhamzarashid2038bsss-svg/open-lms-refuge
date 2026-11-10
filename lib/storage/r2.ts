import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { readR2Config, type R2Config } from "./r2-config";
import { StorageUnavailableError, type StorageAdapter } from "./types";

// Cloudflare R2 does not document support for the S3 checksum headers
// x-amz-checksum-sha256 and ChecksumAlgorithm. Content-MD5 is a different
// fingerprint. This command signs the key, type, and size only. The server
// hashes the stored object with SHA-256 after the upload.
export function submissionPutCommand(
  bucket: string,
  input: { key: string; contentType: string; byteSize: number },
): PutObjectCommand {
  return new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.byteSize,
  });
}

export function r2ClientOptions(config: R2Config): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const metadata = "$metadata" in error ? error.$metadata : null;
  const status =
    metadata && typeof metadata === "object" && "httpStatusCode" in metadata ? Number(metadata.httpStatusCode) : 0;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

function toNodeStream(body: unknown): Readable | null {
  if (body instanceof Readable) return body;
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  return null;
}

export function createR2Storage(config: R2Config): StorageAdapter {
  const client = new S3Client(r2ClientOptions(config));
  const bucket = config.bucket;
  return {
    async presignPut(input) {
      const url = await getSignedUrl(client, submissionPutCommand(bucket, input), { expiresIn: input.expiresInSeconds });
      return { url, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() };
    },
    async presignGet(input) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: input.key });
      const url = await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
      return { url, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() };
    },
    async head(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { byteSize: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
      } catch (error) {
        if (isMissing(error)) return null;
        throw new StorageUnavailableError();
      }
    },
    async open(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return toNodeStream(result.Body);
      } catch (error) {
        if (isMissing(error)) return null;
        throw new StorageUnavailableError();
      }
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isMissing(error)) return;
        throw new StorageUnavailableError();
      }
    },
  };
}

// Empty configuration is unavailable. There is no public bucket and no in-memory stand-in.
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageAdapter | null {
  const config = readR2Config(env);
  if (!config) return null;
  return createR2Storage(config);
}
