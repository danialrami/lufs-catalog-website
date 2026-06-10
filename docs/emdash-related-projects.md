# External Projects & Links

This document provides quick references to related projects explored during EmDash research.

---

## Related Repositories

### Local Projects

| Project | Location | Description |
|---------|----------|-------------|
| **lufs-catalog-website** | `~/repos/lufs-catalog-website` | This repository — static Astro music catalog |
| **lufs-blog-pipeline** | `~/repos/lufs-blog-pipeline/` | Conceptual AI blog drafting pipeline |
| **comfy-ui_init_audio_4_api** | `~/repos/comfy-ui_init_audio_4_api/` | AI music generation via ComfyUI |

### Siku (Homelab)

| Service | Location | Description |
|---------|----------|-------------|
| **danialrami** | `~/danialrami/` | Hugo blog, self-hosted on siku |
| **siku Docker** | `siku:~/docker/` | 40+ Docker services |

### External Resources

- [danialrami.com](https://danialrami.com) — Your Hugo blog
- [lufs.audio](https://lufs.audio) — Music catalog (Cloudflare Pages)

---

## EmDash Resources

### Official

| Resource | URL |
|----------|-----|
| Website | https://emdashcms.com |
| Playground | https://emdashcms.com/playground |
| GitHub | https://github.com/emdash-cms/emdash |
| Documentation | https://emdashcms.com/docs |
| MCP Reference | https://emdashcms.com/docs/reference/mcp-server |

### Key Blog Posts

- [Introducing EmDash (Cloudflare Blog)](https://blog.cloudflare.com/emdash-wordpress/)
- [EmDash first thoughts (Brian Coords)](https://www.briancoords.com/emdash-first-thoughts-and-takeaways-for-wordpress/)
- [EmDash: A fresh take (Maciek Palmowski)](https://maciekpalmowski.dev/blog/emdash-a-fresh-take-on-cms/)

---

## Architecture Decision Notes

### EmDash vs Static Astro (for this project)

| Aspect | Static Astro | EmDash |
|--------|-------------|--------|
| Updates | Rebuild + deploy | No rebuild needed |
| Database | None | Required |
| Admin UI | None (local) | Built-in |
| Cost | Free (Pages) | Variable |
| Complexity | Lower | Higher |

**Decision**: Keep static Astro for catalog site.

### Self-Hosting Architecture

For running EmDash on siku:

```
┌─────────────────────────────────────────────────────────────┐
│                        siku (Homelab)                       │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ emdash-blog│    │emdash-music│    │emdash-portfolio│   │
│  │  :4331    │    │  :4332    │    │  :4333     │   │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│                     ┌─────▼─────┐                         │
│                     │  Caddy   │ (reverse proxy)           │
│                     └─────┬─────┘                         │
│                           │                                │
│                    ┌──────▼──────┐                       │
│                    │Cloudflare  │ (tunnel to public)       │
│                    │  Tunnel    │                         │
│                    ���─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Storage Options

| Backend | Use Case | Complexity |
|---------|---------|-----------|
| **Local filesystem** | Development, single instance | Low |
| **Garage (S3)** | Network storage, multiple instances | Medium |
| **Cloudflare R2** | Production, edge caching | Low |

---

## Docker Quick Reference

### Basic EmDash Docker Compose

```yaml
services:
  emdash:
    image: node:20-alpine
    build: .
    ports:
      - "4321:4321"
    volumes:
      - emdash_data:/app/data
    environment:
      - DATABASE_URL=file:./data/emdash.db
    restart: unless-stopped

volumes:
  emdash_data:
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection | `file:./data.db` |
| `EMDASH_URL` | Remote instance URL | `https://blog.example.com` |
| `LIBSQL_DATABASE_URL` | libSQL remote | `libsql://example.turso.io` |
| `S3_ENDPOINT` | S3 storage | `http://garage:3900` |

---

## Content Collections Schema Reference

### Example: Posts Collection

```json
{
  "slug": "posts",
  "label": "Blog Posts",
  "fields": [
    { "slug": "title", "type": "string", "required": true },
    { "slug": "slug", "type": "slug", "required": true },
    { "slug": "content", "type": "portableText" },
    { "slug": "excerpt", "type": "text" },
    { "slug": "featuredImage", "type": "media" },
    { "slug": "status", "type": "select", "options": ["draft", "published"] }
  ]
}
```

---

## Navigation

- [Home](./) — Main documentation
- [emdash-research.md](./emdash-research.md) — Full EmDash research
- [emdash-future-plans.md](./emdash-future-plans.md) — Future directions
- [PRD.md](./PRD.md) — Product requirements
- [TDD.md](./TDD.md) — Technical design