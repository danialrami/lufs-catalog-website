# 08 — The `catalog-operator` opencode Agent

A project-level [opencode](https://opencode.ai/docs/agents/) agent that lets you run
the whole catalog in natural language — "update the site with the audio I just
added", "switch production to the local rustfs instance", "what's the current
config?", "deploy". It follows the conventions in your
`opencode-agent-definitions` repo (markdown agent in `.opencode/agents/`,
least-privilege `permission` map, single clear responsibility, hard stops for
destructive actions).

---

## 1. Where it lives

```
.opencode/agents/catalog-operator.md     # the agent (primary, auto-discovered)
scripts/catalog-config.sh                # read-only: print effective config (masks secrets)
scripts/catalog-set-origin.sh            # switch STORAGE_PRIMARY (r2 <-> rustfs)
.env.production.example                  # the centralized config it reads/edits
```

opencode auto-discovers `.opencode/agents/*.md`, so once the repo is checked out,
`opencode` in this directory offers **catalog-operator** as a primary agent (Tab to
switch). No extra config needed.

---

## 2. What it can do (intent → action)

| You say… | It runs | Notes |
|---|---|---|
| "What's the current config / where are we serving from?" | `./scripts/catalog-config.sh` | Read-only, masks secrets |
| "Switch production to rustfs" / "…back to R2" | `./scripts/catalog-set-origin.sh <origin>` | 🛑 confirms first; warns if rustfs isn't stood up |
| "Process the new audio I dropped in" | `./scripts/catalog-process.sh <file>… \| --album <dir>` | 🛑 runs the lufs-workchain `astro-catalog` chain; leaves `{track-name}_astro-catalog/` ready to ingest |
| "Update the site with the new audio" | `catalog-process.sh` (if unprocessed) → `pnpm catalog:ingest` or `./catalog-deploy.sh --ingest` | 🛑 confirms before any upload/deploy |
| "Run it locally / preview" | `./catalog-dev.sh --ingest` or `pnpm dev` | |
| "Build" | `pnpm build` | |
| "Deploy / publish" | `./catalog-deploy.sh` | 🛑 confirms before pushing to production |
| "Set the ISRC / add streaming links / fix a title" | edits the release `.md` frontmatter | Human-owned fields; ingest won't clobber them |

It is told to **read state first** (`catalog-config.sh` / the files), **plan and
confirm**, **execute the least-privilege command**, then **report exactly what
changed**.

---

## 3. Safety model

- **Least privilege.** `read/glob/grep/list` allowed; `webfetch/websearch` denied;
  `bash` is default-`ask` with a small allowlist of safe commands
  (`catalog-config.sh`, `pnpm build/dev/preview/test`, `ffprobe`, `git
  status/diff/log`, local dev sync).
- **Hard stops** (require explicit approval) on everything that mutates production or
  storage: switching `STORAGE_PRIMARY`, R2/rustfs uploads, `catalog-deploy.sh`, any
  `git push`. `rm *` is denied outright; `wrangler*` is `ask`.
- **Secrets** are never printed (the config script masks keys); the agent must never
  commit `.env*` or bake R2 keys into the site bundle.
- **Respects field ownership** — it won't overwrite human-edited frontmatter
  (`title`, `isrc`, `streamingLinks`, `displayTitle`, `tags`, `status`).

---

## 4. The helper scripts

### `scripts/catalog-process.sh <file>… | --album <dir>`
Runs the lufs-workchain `astro-catalog` chain on each audio file and normalizes the
output to `{track-name}_astro-catalog/` in the album root (the shape the ingest
expects). This is the "new audio → ready to ingest" step. Requires the
`lufs-workchain` CLI on PATH + ffmpeg + the workchain's Python deps; override the
command with `WORKCHAIN_CMD`. After it, run `pnpm catalog:ingest`.

### `scripts/catalog-config.sh`
Read-only. Loads the first of `.env.production` / `.env.local` / `.env` (or `--env
<file>`), prints the effective storage mode, primary origin, mirror, fallback,
organize mode, source path, and per-origin R2/rustfs settings — **masking** access
keys (`****1234`) — then prints the single ACTIVE origin line.

### `scripts/catalog-set-origin.sh <r2|rustfs> [--env <file>] [--force]`
Flips `STORAGE_PRIMARY` in the env file. Refuses to switch to `rustfs` unless
`RUSTFS_ENDPOINT` is set (or `--force`), so you can't point production at a NAS
endpoint that isn't up yet. Reminds you to rebuild/redeploy afterward.

Both are pure-local (no cloud calls), so they're safe and were tested before commit.

---

## 5. Model & tuning

- `mode: primary`, `temperature: 0.2` (operational/precise).
- `model: anthropic/claude-sonnet-4-20250514` — **adjust to your current default**
  (run `opencode models`); bump to an Opus-class model if you want heavier reasoning
  for ingest edge cases. This is a one-line change in the frontmatter.

---

## 6. External dependency

Everything the agent references now exists in the repo (`catalog:ingest`,
`catalog-deploy.sh`, the signing Worker, `catalog-config.sh`, `catalog-set-origin.sh`,
`catalog-process.sh`). The one **external** dependency is the **`lufs-workchain` CLI**
(used by `catalog-process.sh`): it must be installed on PATH from the workchain repo
(`cd cli && npm install && npm link`, plus `uv sync` for the artwork/canvas Python
deps). If it's missing, the agent is instructed to say so plainly and stop rather than
improvise.

---

## 7. Extending it later

- Add **subagents** under `.opencode/agents/` for focused jobs (e.g. a read-only
  `release-auditor` that checks every `.md` has valid R2 keys + artwork) and let
  `catalog-operator` invoke them via `task` permissions.
- If you prefer a single config file, the same agent can be expressed in
  `opencode.json` (see your `opencode-agent-definitions/docs/02`), but the markdown
  form here is the recommended, auto-discovered, version-controlled approach.
