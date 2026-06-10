# EmDash Future Plans

**Last Updated:** April 7, 2026  
**Status:** Someday / Exploration

---

## Overview

This document outlines potential future directions for incorporating EmDash into your infrastructure, particularly for projects beyond the static catalog site.

> **Note:** For the `lufs-catalog-website` specifically, EmDash is **not recommended**. The current static Astro approach is simpler, cheaper, and appropriate for the use case.

---

## Project Priorities

| Project | EmDash Fit | Priority | Notes |
|---------|-----------|----------|-------|
| **danialrami** (blog) | **High** | 1 | Best match — gives admin UI |
| **lufs-blog-pipeline** | Medium | 2 | Formalizes AI pipeline |
| **comfy-ui outputs** | Low | 3 | Cataloging, not core |

---

## 1. danialrami Hugo Blog → EmDash

### Current State

- **Location**: `~/danialrami/` on siku
- **Stack**: Hugo + custom "poison" theme
- **Content**: Markdown files in `content/posts/`, `content/resources/`
- **Hosting**: Self-hosted via Docker (Ghost container pattern)
- **URL**: danialrami.com

### Migration Path

#### Option A: Replace Hugo with EmDash

**Pros:**
- Browser-based admin UI (no text editor)
- Role-based workflows (draft → review → publish)
- MCP server for AI writing assistants
- Type-safe content schemas

**Cons:**
- Lose Git-based version control for content
- Need to rebuild "poison" theme as Astro theme
- Database required (vs. static markdown)

```yaml
# docker/emdash-blog/compose.yml
services:
  emdash-blog:
    build: ./emdash-blog
    ports:
      - "4331:4321"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    environment:
      - DATABASE_URL=file:./data/emdash.db
    restart: unless-stopped
```

#### Option B: Keep Hugo + Use EmDash for Specific Features

- Use EmDash only for **new content types** (e.g., newsletter archives, project showcases)
- Hugo remains for blog posts
- EmDash provides Admin UI for non-technical content contributors

#### Recommended Approach

**Option B** (hybrid) or wait until EmDash matures. The Hugo setup works well.

---

## 2. lufs-blog-pipeline Integration

### Current State (Planned)

Location: `~/repos/lufs-blog-pipeline/`

Purpose: AI-assisted blog post drafting with multi-stage refinement:
1. Research (fetch trends)
2. Ideation (generate angles)
3. Outline → Draft → Edit cycles
4. Publish

### How EmDash Could Help

| Component | EmDash Integration |
|-----------|---------------------|
| **Content storage** | Use EmDash collections for drafts |
| **MCP Server** | Expose pipeline tools to AI agents |
| **Admin UI** | Review/approve AI-generated drafts |
| **Workflow** | Role-based (author → editor → publish) |

### Architecture Concept

```
┌─────────────────┐     ┌─────────────────┐
│  lufs-blog-      │     │   EmDash        │
│  pipeline       │────▶│   (collections)│
│  (LLM-powered)  │     │   - drafts    │
│                 │     │   - posts    │
└─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  YAML prompts   │     │   Admin UI     │
│  (structured)  │     │   (review)     │
└─────────────────┘     └─────────────────┘
```

### Implementation

```typescript
// emdash/collections/drafts.ts
{
  slug: "drafts",
  label: "Blog Drafts",
  fields: [
    { slug: "title", type: "string" },
    { slug: "prompt", type: "string" },
    { slug: "llm_model", type: "string" },
    { slug: "status", type: "select", options: ["generating", "review", "approved", "published"] },
    { slug: "content", type: "portableText" }
  ]
}
```

---

## 3. AI Music Generation Catalog (comfy-ui Outputs)

### Current State

Location: `~/repos/comfy-ui_init_audio_4_api/`

Purpose: Generate music via ACE-Step 1.5 + ComfyUI from YAML prompts.

Output structure:
```
<OUTPUT_DIR>/
├── 2026-04-07_213045_neon_tide/
│   ├── input_neon_tide.yaml
│   ├── neon_tide.flac
│   ├── neon_tide.wav
│   └── neon_tide_spectrogram.png
```

### EmDash: Cataloging Use Case

**Not for generation** — the pipeline handles that. Instead, use EmDash for **cataloging outputs**:

```typescript
// emdash/collections/generations.ts
{
  slug: "generations",
  label: "AI Generations",
  fields: [
    { slug: "title", type: "string" },
    { slug: "yaml_prompt", type: "text" },
    { slug: "generated_at", type: "datetime" },
    { slug: "audio_files", type: "media", multiple: true },
    { slug: "spectrogram", type: "media" },
    { slug: "rating", type: "select", options: ["discarded", "draft", "approved"] },
    { slug: "notes", type: "text" }
  ]
}
```

### Benefits

1. **Browser-based review** — browse all generations, listen, select favorites
2. **Search** — query by date, tags, rating
3. **Metadata** — beyond filesystem
4. **Workflow** — track "needs revision" → "approved"

---

## 4. Self-Hosted Infrastructure (Siku)

### Existing Siku Stack

```
siku ~/docker/
├── ghost/          # Blog (currently not in use?)
├── forgejo/        # Code
├── immich/        # Photos
├── plex/          # Media
├── nextcloud/     # Files
└── ...40+ more services
```

### EmDash Docker Setup

```yaml
# docker/emdash/compose.yml
services:
  emdash:
    image: node:20-alpine
    build:
      context: ./emdash-src
      dockerfile: Dockerfile
    ports:
      - "4331:4321"
    volumes:
      - emdash_data:/app/data
      - emdash_uploads:/app/uploads
      - /mnt/barracuda/media:/mnt/barracuda/media:ro
    environment:
      - DATABASE_URL=file:./data/emdash.db
      - STORAGE_DIR=./uploads
    restart: unless-stopped
    networks:
      - homelab

volumes:
  emdash_data:
  emdash_uploads:

networks:
  homelab:
    external: true
```

### Database Options

| Option | Complexity | Best For |
|--------|-----------|---------|
| **SQLite** (default) | Low | Single site, no external deps |
| **PostgreSQL** | Medium | Existing MySQL infrastructure |
| **libSQL** (Turso) | Low | Remote SQLite with edge replicas |

**Recommendation**: Start with SQLite for simplicity.

---

## 5. S3-Compatible Storage (Garage)

### Concept

You mentioned running **Garage** (S3-compatible) for:
- Media storage (music files)
- Network mount (barracuda)

### EmDash S3 Configuration

```javascript
import emdash, { s3 } from "emdash/astro";

export default defineConfig({
  integrations: [
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      storage: s3({
        endpoint: "http://garage.siku.local:3900",
        bucket: "emdash-media",
        accessKeyId: process.env.GARAGE_ACCESS_KEY,
        secretAccessKey: process.env.GARAGE_SECRET,
        region: "auto",
        publicUrl: "https://media.yourdomain.com"
      })
    })
  ]
});
```

### Benefits

1. **Centralized media** — all EmDash instances use same bucket
2. **Network efficiency** — storage on barracuda, compute on siku
3. **S3 API** — portable, well-documented

### Docker Compose with Garage

```yaml
# docker/emdash-full/compose.yml
services:
  garage:
    image: degarage/garage:v1.0.0
    ports:
      - "3900:3900"
      - "3901:3901"
    volumes:
      - garage_data:/data
    environment:
      - GARAGE_LOCAL_API_SECRET=<generate-secure-key>

  emdash-blog:
    build: ./emdash-blog
    depends_on:
      - garage
    environment:
      - S3_ENDPOINT=http://garage:3900
      - S3_BUCKET=emdash-blog
      - GARAGE_ACCESS_KEY=<key>
      - GARAGE_SECRET=<secret>

volumes:
  garage_data:
```

---

## 6. Multi-Site Dashboard Integration

### Existing: Homarr / Homepage

You already have `homarr` or `homepage` in your Docker stack — these can link to EmDash admin UIs.

```yaml
# homepage/widgets.yaml
- docker:
    widgets:
      - type: docker
        container: emdash-blog
        url: "http://siku:4331"
      - type: docker
        container: emdash-music
        url: "http://siku:4332"
```

---

## Summary: Recommended Path Forward

### Phase 1: Exploration (This Week)

1. **Try EmDash locally**: `npm create emdash@latest` on your Mac
2. **Explore playground**: [emdashcms.com](https://emdashcms.com)
3. **Read docs**: EmDash documentation

### Phase 2: Self-Hosted Test (Someday)

1. **Docker on siku**: Test container with SQLite
2. **Connect via tunnel**: Cloudflare Tunnel → internal EmDash
3. **Explore admin UI**: Create collections, add content

### Phase 3: Project Migration (Future)

Priority order:
1. **danialrami** — only if EmDash feels stable
2. **Music catalog** — for comfy-ui generations
3. **Blog pipeline** — integrate with existing pipeline

---

## See Also

- [emdash-research.md](./emdash-research.md) — Full research and context
- [Cloudflare Blog: EmDash](https://blog.cloudflare.com/emdash-wordpress/) — Primary announcement
- [EmDash GitHub](https://github.com/emdash-cms/emdash) — Source code
- [danialrami/](../danialrami/) — Hugo blog (external)
- [comfy-ui_init_audio_4_api](../../comfy-ui_init_audio_4_api/) — AI music pipeline

---

## Questions / Open Items

- [ ] Preferred database (SQLite/PostgreSQL)?
- [ ] Garage S3 setup timeline?
- [ ] Which project to test first?
- [ ] Self-signup preferences for EmDash?