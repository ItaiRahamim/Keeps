# Cloudflare R2 setup notes

This project has no live R2 bucket yet — the env vars in `.env.local.example`
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`NEXT_PUBLIC_R2_PUBLIC_BASE_URL`) are blank placeholders. Once a bucket
exists, two things need to happen manually (neither was applied by this
agent — no dashboard/wrangler access from here):

## 1. Fill in the env vars

- `R2_ACCOUNT_ID` — Cloudflare account ID.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — an R2 API token's
  key pair (server-only; never prefix these with `NEXT_PUBLIC_`, never
  expose them to the client — they're read only in
  `src/app/api/uploads/presign/route.ts`).
- `R2_BUCKET` — the bucket name.
- `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` — the bucket's public base URL (either
  the `r2.dev` public bucket URL, or a custom domain fronting the bucket).
  This one *is* public by design — it's just a base URL for reading media
  back, not a credential.

## 2. Apply CORS rules

The presign route mints direct browser→R2 `PUT` uploads, so the bucket needs
CORS rules allowing that. This repo's `r2-cors.json` (repo root) holds the
rule set:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply it once the bucket exists, via either:

```bash
wrangler r2 bucket cors put <bucket-name> --rules r2-cors.json
```

or the Cloudflare dashboard (R2 → bucket → Settings → CORS Policy → paste
the JSON above).

**Before production launch**, tighten `AllowedOrigins` from `"*"` down to the
real app origin(s) (e.g. `https://keeps.example.com`). `"*"` is only a
reasonable placeholder for local dev, where the origin is unpredictable
(`localhost` port, LAN IP for testing on a phone, etc).

## 3. Apply the DB migration

`supabase/migrations/0001_init.sql` also hasn't been applied anywhere yet —
see the comment at the top of that file for how to run it once a Supabase
project exists.
