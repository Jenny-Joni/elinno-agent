# Elinno Agent

The website and (eventually) full-stack application for **Elinno Agent**.

🌐 **Live**: [elinnoagent.com](https://elinnoagent.com)

---

## Stack

- **Frontend** — static HTML/CSS, served by Cloudflare Pages
- **Backend** — Cloudflare Pages Functions *(to be added)*
- **Database** — Cloudflare D1 *(to be added)*
- **Auth** — cookie-based sessions over D1 *(to be added)*

## Repository layout

```
.
├── public/          ← static site (deployed to Cloudflare Pages)
│   ├── index.html
│   └── styles.css
├── functions/       ← serverless API endpoints (Pages Functions)
├── schema.sql       ← D1 database schema
└── README.md
```

## Local preview

Open `public/index.html` directly in a browser, or run:

```bash
npx wrangler pages dev public
```

## Deployment

Pushing to `main` automatically deploys via Cloudflare Pages.
No manual build step — `public/` is served as-is.
