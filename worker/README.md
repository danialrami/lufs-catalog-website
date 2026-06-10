# lufs-catalog-stream (Cloudflare Worker)

Signs short-lived presigned GET URLs for **private** audio objects in the
`lufs-catalog` R2 bucket. The catalog site calls it per play; the browser never
holds a durable URL or the signing secret. See
`docs/implementation/06-cdn-and-s3-guide.md` and `09-ingest-and-deploy.md`.

## Deploy

```bash
cd worker
npm install
npx wrangler login

# Set the three secrets (from your R2 API token):
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

npx wrangler deploy
```

Then in the Cloudflare dashboard, map a route / custom domain (e.g.
`stream.lufs.audio`) to this Worker, and set `PUBLIC_R2_STREAM_URL` to that URL in
`.env.production`.

## Contract

```
GET /?key=releases/<collection>/<n>/<file>.mp3
→ 200 { "url": "<presigned-url>", "expiresIn": 3600 }
→ 403 if key is not under releases/ , contains "..", or Origin isn't allowlisted
```

Only keys under `releases/` are ever signed. Origin is checked against
`ALLOWED_ORIGIN` (comma-separated). TTL via `URL_TTL_SECONDS` (default 3600, max 86400).
