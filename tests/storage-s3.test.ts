import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";
import { GET_URL_SECONDS, PUT_URL_SECONDS } from "../lib/storage/file-rules";
import { readObjectStorageConfig } from "../lib/storage/s3-config";
import { s3ClientOptions, storageFromEnv, submissionPutCommand } from "../lib/storage/s3";

const ENDPOINT = "https://s3.eu-central-003.backblazeb2.com";
const REGION = "eu-central-003";
const BUCKET = "open-lms-refuge-private";
const KEY_ID = "test-key-id";
const APPLICATION_KEY = "test-application-key";
const OBJECT_KEY = "submissions/00000000-0000-4000-8000-000000000011";

function backblazeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    OBJECT_STORAGE_ENDPOINT: ENDPOINT,
    OBJECT_STORAGE_REGION: REGION,
    OBJECT_STORAGE_BUCKET: BUCKET,
    OBJECT_STORAGE_ACCESS_KEY_ID: KEY_ID,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: APPLICATION_KEY,
    ...overrides,
  };
}

function assertSignedUrl(url: string, expires: string) {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("https:");
  const virtualHost = `${BUCKET}.${new URL(ENDPOINT).hostname}`;
  const endpointHost = new URL(ENDPOINT).hostname;
  expect([endpointHost, virtualHost]).toContain(parsed.hostname);
  expect(decodeURIComponent(parsed.pathname)).toContain(OBJECT_KEY);
  if (parsed.hostname === endpointHost) {
    expect(parsed.pathname.startsWith(`/${BUCKET}/`)).toBe(true);
  }
  expect(parsed.searchParams.get("X-Amz-Expires")).toBe(expires);
  expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  expect(parsed.searchParams.get("X-Amz-Credential") ?? "").toContain(`/${REGION}/s3/`);
  expect(parsed.searchParams.get("X-Amz-Credential") ?? "").toContain(KEY_ID);
  const query = parsed.search.toLowerCase();
  expect(query.includes("checksum")).toBe(false);
  expect(query.includes("x-amz-acl")).toBe(false);
  expect(url.includes(APPLICATION_KEY)).toBe(false);
}

describe("S3-compatible storage configuration", () => {
  it("maps the Backblaze endpoint, region, bucket, and explicit credentials", () => {
    const config = readObjectStorageConfig(backblazeEnv());
    expect(config).toEqual({
      endpoint: ENDPOINT,
      region: REGION,
      bucket: BUCKET,
      accessKeyId: KEY_ID,
      secretAccessKey: APPLICATION_KEY,
    });
    expect(s3ClientOptions(config!)).toMatchObject({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: {
        accessKeyId: KEY_ID,
        secretAccessKey: APPLICATION_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    expect(storageFromEnv(backblazeEnv())).not.toBeNull();
  });

  it("stays unavailable when a required setting is missing or invalid", () => {
    for (const name of [
      "OBJECT_STORAGE_ENDPOINT",
      "OBJECT_STORAGE_REGION",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_ACCESS_KEY_ID",
      "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    ]) {
      expect(readObjectStorageConfig(backblazeEnv({ [name]: "  " }))).toBeNull();
      expect(storageFromEnv(backblazeEnv({ [name]: "" }))).toBeNull();
    }
    expect(readObjectStorageConfig(backblazeEnv({ OBJECT_STORAGE_ENDPOINT: "http://s3.eu-central-003.backblazeb2.com" }))).toBeNull();
    expect(
      readObjectStorageConfig(
        backblazeEnv({ OBJECT_STORAGE_ENDPOINT: "https://key:secret@s3.eu-central-003.backblazeb2.com" }),
      ),
    ).toBeNull();
    expect(
      readObjectStorageConfig(backblazeEnv({ OBJECT_STORAGE_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com/bucket" })),
    ).toBeNull();
    expect(readObjectStorageConfig(backblazeEnv({ OBJECT_STORAGE_REGION: "us-west-004" }))).toBeNull();
    expect(readObjectStorageConfig(backblazeEnv({ OBJECT_STORAGE_BUCKET: "open/lms" }))).toBeNull();
    expect(readObjectStorageConfig(backblazeEnv({ OBJECT_STORAGE_SECRET_ACCESS_KEY: "has space" }))).toBeNull();
  });

  it("signs a private PUT and GET for the configured bucket and object key", async () => {
    const config = readObjectStorageConfig(backblazeEnv());
    expect(config).not.toBeNull();
    const networkCalls: string[] = [];
    const client = new S3Client({
      ...s3ClientOptions(config!),
      requestHandler: {
        handle() {
          networkCalls.push("sent");
          return Promise.reject(new Error("This test must not contact object storage."));
        },
      },
    });
    try {
      const putCommand = submissionPutCommand(config!.bucket, {
        key: OBJECT_KEY,
        contentType: "image/jpeg",
        byteSize: 4,
      });
      expect(putCommand.input.Bucket).toBe(BUCKET);
      expect(putCommand.input.Key).toBe(OBJECT_KEY);
      expect(putCommand.input.ContentType).toBe("image/jpeg");
      expect(putCommand.input.ContentLength).toBe(4);
      expect(putCommand.input.ChecksumSHA256).toBeUndefined();
      expect(putCommand.input.ChecksumAlgorithm).toBeUndefined();
      expect(putCommand.input.ContentMD5).toBeUndefined();
      expect(putCommand.input.ACL).toBeUndefined();

      const putUrl = await getSignedUrl(client, putCommand, { expiresIn: PUT_URL_SECONDS });
      const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: OBJECT_KEY }), {
        expiresIn: GET_URL_SECONDS,
      });
      assertSignedUrl(putUrl, String(PUT_URL_SECONDS));
      assertSignedUrl(getUrl, String(GET_URL_SECONDS));
      expect(networkCalls).toEqual([]);
    } finally {
      client.destroy();
    }
  });
});
