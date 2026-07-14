# Infra notes

## S3 bucket CORS (image uploads)

The invitation studio uploads cover photos straight to S3 via a presigned PUT
(`core-service` `POST /uploads/generate-upload-url` → browser `PUT`). Browser →
S3 uploads require a CORS rule on the bucket; a `PUT` always triggers a preflight.

Apply `s3-cors.json` once with a credential that has `s3:PutBucketCORS`
(the app's `showup-api` user does **not** - it's denied on purpose):

```bash
aws s3api put-bucket-cors \
  --bucket showup-app-dev \
  --region il-central-1 \
  --cors-configuration file://infra/s3-cors.json

# verify
aws s3api get-bucket-cors --bucket showup-app-dev --region il-central-1
```

In the AWS console the CORS editor expects **only the inner array** (the value
of `CORSRules`), not the wrapping object: S3 → `showup-app-dev` → Permissions →
Cross-origin resource sharing (CORS) → Edit → paste just the `[ { ... } ]` part.

Add the production origin to `AllowedOrigins` when the prod bucket is set up
(and repeat for that bucket).
