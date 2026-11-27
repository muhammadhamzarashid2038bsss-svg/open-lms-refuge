# Private homework and course files

Digital and Both assignments can accept a JPEG, PNG, WebP, or PDF of at most 1 MB. Teachers can add a course PDF of up to 25 MB or an MP3 of up to 20 MB. Those files are not stored in PostgreSQL and they are not stored in the browser cache. The browser uploads them with a short-lived link to one private Backblaze B2 bucket, using Backblaze's S3-compatible API.

The bucket `open-lms-refuge-private` already exists in region `eu-central-003`. This repository does not contain the key. For local development the bucket is configured. A course PDF upload and a learner download of that file were checked by hand. Automated tests still use a stand-in store. That check does not cover every file type, an interrupted homework upload, or every permission case on the live bucket.

## How long the links last

- Homework uploads use a 10-minute upload link. That is long enough to send 1 MB on a weak connection.
- Course PDF and MP3 uploads use a 60-minute upload link. A 25 MB file on a weak connection needs longer than the 10 minutes used for a 1 MB homework photo. The link is still limited to one object, one type, and one size.
- Downloads use a 2-minute link for both homework files and course files.

Neither link is saved in the database. The browser sends `Content-Type` and `Content-Length` only.

## Settings

Type these into `.env` on the server. Do not put the key in git, in a chat, or in any `NEXT_PUBLIC_` variable. The browser must not receive the key.

| Setting | Value |
| --- | --- |
| `OBJECT_STORAGE_ENDPOINT` | `https://s3.eu-central-003.backblazeb2.com` |
| `OBJECT_STORAGE_REGION` | `eu-central-003` |
| `OBJECT_STORAGE_BUCKET` | `open-lms-refuge-private` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | The Backblaze Key ID for the bucket-restricted application key. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | The Backblaze Application Key. Backblaze shows this once. |

The application key needs Read and Write on this bucket only. Do not use a master application key. Do not make the bucket public. Do not add a public object ACL.

If any of the five values is missing or invalid, the app says file storage is unavailable. It does not switch to a public folder. Restart the app after saving `.env`. Next.js reads these values at startup.

The endpoint is the regional S3 address, not a public file URL and not a path that includes the bucket name. The region in the endpoint and `OBJECT_STORAGE_REGION` must be the same. The app passes those two values, plus the key id and application key, to the AWS SDK for JavaScript v3. It does not use an AWS profile on the computer.

## How a file is checked

The AWS SDK normally adds a CRC32 checksum header. Backblaze rejects that header. The client is set so that header is not added. The app also does not send `x-amz-checksum-sha256`. The phone sends the SHA-256 fingerprint with the upload request. After the file is in the bucket, the server reads the object, checks the file type from the bytes, measures the size, and calculates SHA-256 itself. The homework row is marked stored only when the size, type, and fingerprint all match. A bad file is marked failed and, when the server created the object key, the object is removed. The same homework row can be tried again with the same `clientSubmissionId`. A second row is not created.

The object key is `submissions/` plus an id. The original file name is not part of the key. Homework stays at 1 MB. Its upload link lasts 10 minutes, and its download link lasts 2 minutes.

## Course PDF and MP3 files

Teachers add a PDF or an MP3 on the course page. A PDF can be up to 25 MB. An MP3 can be up to 20 MB. No other audio type is accepted.

The upload link lasts 60 minutes, as listed above. The download link lasts 2 minutes.

The object key is `course-resources/` plus an id. It is not a homework key. The resource appears in the course list only after the server has read the stored bytes and checked the size, the file type, and the SHA-256 checksum. A failed upload is removed and is not listed.

Existing demo files use keys that start with `private/demo/`. Those rows are not objects in this bucket. Their download buttons still return a small stand-in file.

## Bucket CORS

The browser sends the file directly to Backblaze, so the private bucket needs a CORS rule. Use the real site addresses. Do not use `*`. Do not allow delete. Keep the bucket private when you save the rule.

- Development origin: `http://localhost:3000`
- Production origin: `https://YOUR_DEPLOYED_ORIGIN`

Replace `https://YOUR_DEPLOYED_ORIGIN` with the real https address of this app, with no path and no trailing slash.

In the bucket's CORS rules, use Backblaze's rule format:

```json
[
  {
    "corsRuleName": "homeworkBrowser",
    "allowedOrigins": ["http://localhost:3000", "https://YOUR_DEPLOYED_ORIGIN"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["content-type", "content-length"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
```

The service worker does not cache `/api/submissions` or these file links. Private files stay out of the precache.
