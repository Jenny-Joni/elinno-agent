# Auth system — setup instructions

These are the one-time steps to get the new login / admin system running on
production. Most of it is in Cloudflare's dashboard; nothing tricky, but order
matters.

> **Estimated total time:** ~20 minutes, plus ~15 min waiting for Resend DNS
> verification to propagate.

---

## 1. Pull the new files into your repo

The new files are:

```
elinno-agent/
├── public/
│   ├── index.html              ← REPLACED (welcome page now embeds the login form in the hero)
│   ├── styles.css              ← MODIFIED (appended .hero-login styles; rest unchanged)
│   ├── auth.css                ← NEW (styles for forgot/reset/dashboard/admin)
│   ├── login.html              ← redirect-to-/ alias for old bookmarks
│   ├── forgot-password.html    ← NEW
│   ├── reset-password.html     ← NEW
│   ├── dashboard.html          ← NEW
│   └── admin.html              ← NEW
├── functions/
│   ├── _lib/
│   │   ├── auth.js             ← NEW
│   │   └── email.js            ← NEW
│   └── api/
│       ├── login.js            ← NEW
│       ├── logout.js           ← NEW
│       ├── me.js               ← NEW
│       ├── forgot-password.js  ← NEW
│       ├── reset-password.js   ← NEW
│       └── admin/
│           ├── users.js        ← NEW
│           └── users/[id].js   ← NEW
├── scripts/
│   └── seed-admin.mjs          ← NEW (one-time)
├── db/schema-d1.sql            ← REPLACED (placeholder → D1 auth schema)
└── SETUP.md                    ← NEW (this file)
```

> The welcome page at `public/index.html` is rewritten so the email +
> password form lives directly inside the existing dark hero — same
> background, same orbs, same purple wash, but the description paragraph
> is replaced by the form. There's no separate `/login` URL anymore;
> `elinnoagent.com` is the login page. (A tiny `login.html` redirect is
> kept so old bookmarks don't 404.)

---

## 2. Create the D1 database

In a terminal, in your repo:

```bash
npx wrangler login            # if not already logged in
npx wrangler d1 create elinno-agent-db
```

Wrangler will print something like:

```
[[d1_databases]]
binding = "DB"
database_name = "elinno-agent-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id`** — you'll paste it into the dashboard in step 3.

Now apply the schema:

```bash
npx wrangler d1 execute elinno-agent-db --remote --file=./db/schema-d1.sql
```

(`--remote` runs against the real production D1. Without it, it runs against a
local dev DB.)

---

## 3. Bind D1 to the Pages project

In Cloudflare dashboard:

1. **Workers & Pages** → `elinno-agent` → **Settings** → **Bindings**
2. Click **Add** → **D1 database**
3. **Variable name:** `DB` (must be exactly this — the code looks for `env.DB`)
4. **D1 database:** select `elinno-agent-db`
5. Save. **Production** environment.

> ⚠️ Bindings are environment-scoped. If you want previews to also use D1, add
> the same binding under **Preview** (you can point it at the same DB or a
> separate one).

---

## 4. Set up Resend (for password reset emails)

### 4a. Create a Resend account & verify the domain

1. Go to <https://resend.com> → sign up
2. **Domains** → **Add Domain** → `elinnoagent.com`
3. Resend will give you DNS records (a TXT for SPF, a CNAME or two for DKIM,
   optionally a TXT for DMARC). Add them in:
   **Cloudflare dashboard** → `elinnoagent.com` → **DNS** → **Records** →
   **Add record**.
4. Back in Resend, click **Verify**. Sometimes it takes 5–15 minutes for DNS
   to propagate.

### 4b. Create an API key

In Resend: **API Keys** → **Create** → name it `elinno-agent-prod` →
**Permission: Sending access** → scope to the verified domain. Copy the key
(starts with `re_…`).

### 4c. Add the API key as a Cloudflare secret

Cloudflare dashboard → `elinno-agent` → **Settings** → **Variables and
Secrets** → **Add**:

| Variable name | Type | Value |
|---|---|---|
| `RESEND_API_KEY` | Secret | `re_…` (from step 4b) |
| `MAIL_FROM` | Plaintext | `Elinno Agent <noreply@elinnoagent.com>` |
| `SITE_URL` | Plaintext | `https://elinnoagent.com` |

Save. **Production** environment. (Optional: also add to Preview.)

> The `MAIL_FROM` address must be on the verified domain. `noreply@` is fine —
> you don't need to actually receive mail there.

---

## 5. Seed the first admin

Once the schema is applied (step 2), seed your account locally:

```bash
node scripts/seed-admin.mjs jenny@elinnovation.net 'TEMP_PASSWORD_HERE'
```

It prints a `wrangler` command. **Run that command** to insert your admin row
into D1. Use a strong temporary password — you'll change it on first login.

---

## 6. Deploy

```bash
git add .
git commit -m "feat: add auth system (login, password reset, admin)"
git push origin main
```

Cloudflare Pages will deploy automatically (~30 seconds). Watch:
<https://dash.cloudflare.com> → Workers & Pages → `elinno-agent` → Deployments

---

## 7. First login

1. Go to <https://elinnoagent.com>. The dark hero now shows the email +
   password form directly.
2. Sign in with `jenny@elinnovation.net` and the temp password.
3. Because you're an admin, you'll be redirected to `/admin.html`.
4. **Change your password** by clicking "Forgot password?" on the home page
   with your email — the reset email will land in your inbox. Or, leave the
   temp password if you trust it.
5. From `/admin.html`, you can add more users.

---

## 8. Adding & removing users

- **Add:** type email + initial password in the form on `/admin.html`. Tell
  the user the password out-of-band; they can change it via "forgot password"
  if they prefer.
- **Remove:** click **Remove** on the row. Cannot be undone.
- You cannot delete yourself, and you cannot delete the last admin (UI/server
  both block this).

---

## 9. Troubleshooting

**"Invalid email or password" but I'm sure it's right.**
- Check that the D1 binding is named exactly `DB` (case matters).
- Make sure you ran the seed script's output against the **remote** DB
  (`--remote` flag).

**Reset emails never arrive.**
- Resend dashboard → **Logs** will show whether the request even hit Resend.
- If logs are empty, `RESEND_API_KEY` isn't set or isn't being read — check
  Cloudflare secrets and re-deploy (secrets only take effect on next deploy).
- If logs show "delivered" but you don't see it, check spam. Add `noreply@elinnoagent.com`
  to your contacts.
- Domain not verified → emails will fail to send. Verify in Resend dashboard.

**Locked out (forgot admin password, no reset email working).**
- You can always reset directly in D1:
  ```bash
  node scripts/seed-admin.mjs jenny@elinnovation.net 'NEW_PASSWORD'
  ```
  Then run the printed `wrangler` command — but change the SQL from `INSERT`
  to `UPDATE`:
  ```sql
  UPDATE users SET password_hash = '<hash from script>', updated_at = unixepoch()
  WHERE email = 'jenny@elinnovation.net';
  ```

---

## 10. What's NOT included (yet)

- **Rate limiting.** Login and forgot-password endpoints have no per-IP rate
  limits. Cloudflare itself provides some at the edge, but if you start
  getting hammered, add Turnstile in front of these endpoints.
- **Email change / "edit user" UI.** Admins can only add and remove right now.
  Editing requires a small UI + endpoint addition.
- **Self-serve email change for users.** Same — not built.
- **2FA.** Out of scope for this pass.
- **Account lockout after N failed logins.** Not built.
- **Audit log.** No tracking of who created/deleted whom.

These are all easy follow-ups when you want them.
