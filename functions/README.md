# functions/

This folder is reserved for **Cloudflare Pages Functions** — backend API
endpoints that run on Cloudflare's edge.

Future structure will look like:

```
functions/
├── api/
│   ├── signup.js     ← POST /api/signup
│   ├── login.js      ← POST /api/login
│   ├── logout.js     ← POST /api/logout
│   └── me.js         ← GET  /api/me
└── _middleware.js    ← shared logic (auth, CORS, etc.)
```

For now this is empty — we'll add endpoints when we wire up the user-account
system.
