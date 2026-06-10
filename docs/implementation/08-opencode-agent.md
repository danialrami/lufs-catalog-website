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
| "Update the site with the new audio I added" | `./catalog-sync.sh` (local) or `pnpm catalog:ingest` (R2) | 🛑 confirms before any bucket upload |
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

## 4. The two helper scripts

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

## 6. Commands that don't exist yet

The agent references a few commands that land in later build phases:
- `pnpm catalog:ingest` with **R2 upload** (Phase 2/3) — today only the local
  `catalog:ingest:local` exists.
- `./catalog-deploy.sh` (Phase 3).
- the signing Worker / `wrangler` deploy (Phase 2).

The agent is instructed to **say so plainly** if a referenced script isn't present
yet and point at `01-implementation-plan.md` for status — it won't improvise a
substitute. As those scripts land, the agent "lights up" with no edits needed.

---

## 7. Extending it later

- Add **subagents** under `.opencode/agents/` for focused jobs (e.g. a read-only
  `release-auditor` that checks every `.md` has valid R2 keys + artwork) and let
  `catalog-operator` invoke them via `task` permissions.
- If you prefer a single config file, the same agent can be expressed in
  `opencode.json` (see your `opencode-agent-definitions/docs/02`), but the markdown
  form here is the recommended, auto-discovered, version-controlled approach.
