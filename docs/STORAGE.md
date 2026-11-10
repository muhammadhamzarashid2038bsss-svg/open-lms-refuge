# Private homework files

Digital and Both assignments can later accept a JPEG, PNG, WebP, or PDF of at most 1 MB. The file is not stored in PostgreSQL and it is not stored in the browser cache. The phone will upload it with a short-lived link. This stage only builds the server side of that link. No bucket has been created.

## What you will need later

Create these in Cloudflare when the project is ready to use a real bucket. Do not put the secret values in git or in any `NEXT_PUBLIC_` variable.

| Setting | Value |
| --- | --- |
| Account ID | Goes in `R2_ACCOUNT_ID` |
| R2 access key ID | Goes in `R2_ACCESS_KEY_ID` |
| R2 secret access key | Goes in `R2_SECRET_ACCESS_KEY` |
| Bucket name | Goes in `R2_BUCKET_NAME`. Keep the bucket private. Do not turn on the public `r2.dev` website. |
| Region | `auto` |
| S3 endpoint | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |

If any of the four variables is empty, the app says file storage is unavailable. It does not switch to a public folder.

## How a file is checked

R2 does not document the S3 header `x-amz-checksum-sha256`, so the app does not send it. The phone sends the SHA-256 fingerprint with the upload request. After the file is in the bucket, the server reads the object, measures it, and calculates SHA-256 itself. The homework row is marked stored only when the size and the fingerprint both match. A bad file is marked failed and, when the server created the object key, the object is removed. The same homework row can be tried again. A second row is not created.

The upload link lasts 10 minutes, which is long enough to send 1 MB on a weak connection. A download link lasts 2 minutes. Neither link is saved in the database.

## Bucket CORS

The browser sends the file directly to R2, so the bucket needs CORS. Use the real site addresses. Do not use `*`.

- Development origin: `http://localhost:3000`
- Production origin: `https://YOUR_DEPLOYED_ORIGIN`

Replace `https://YOUR_DEPLOYED_ORIGIN` with the real https address of this app, with no path and no trailing slash.

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://YOUR_DEPLOYED_ORIGIN"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The browser upload sends `Content-Type` and `Content-Length` only. It must not send `x-amz-checksum-sha256`. DELETE stays off this list so a phone cannot delete an object by itself.

The service worker does not cache `/api/submissions` or these file links. Private files stay out of the precache.
