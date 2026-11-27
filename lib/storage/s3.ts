import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { readObjectStorageConfig, type ObjectStorageConfig } from "./s3-config";
import { StorageUnavailableError, type StorageAdapter } from "./types";

// The upload command signs the key, type, and size only. It does not set
// ChecksumSHA256, ChecksumAlgorithm, or ContentMD5. Backblaze does not accept
// the AWS checksum headers the same way Amazon S3 does. The server hashes the
// stored object with SHA-256 after the upload.
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

export function s3ClientOptions(config: ObjectStorageConfig): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    // Explicit keys. A developer's AWS profile must not become the centre's
    // file store if one happens to be installed on the same computer.
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // AWS SDK v3 otherwise adds x-amz-checksum-crc32. Backblaze rejects that
    // header, so a valid homework file would fail on a weak connection for
    // an AWS-only reason. Integrity stays the SHA-256 check after upload.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
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

export function createObjectStorage(config: ObjectStorageConfig): StorageAdapter {
  const client = new S3Client(s3ClientOptions(config));
  const bucket = config.bucket;
  return {
    async presignPut(input) {
      const url = await getSignedUrl(client, submissionPutCommand(bucket, input), { expiresIn: input.expiresInSeconds });
      return { url, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() };
    },
    async presignGet(input) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ...(input.contentDisposition ? { ResponseContentDisposition: input.contentDisposition } : {}),
      });
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

// Empty or invalid configuration is unavailable. There is no public bucket
// and no in-memory stand-in.
export function storageFromEnv(
  env: Record<string, string | undefined> = process.env,
): StorageAdapter | null {
  const config = readObjectStorageConfig(env);
  if (!config) return null;
  return createObjectStorage(config);
}
