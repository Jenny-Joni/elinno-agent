# PRD — Elinno Agent Login System

| | |
|---|---|
| **Owner** | Jenny |
| **Status** | Implemented, pending deploy |
| **Last updated** | 2026-04-30 |
| **Related docs** | `PROJECT.md`, `SETUP.md`, `DESIGN.md` |

---

## 1. Summary

Add email + password authentication to elinnoagent.com so that the planned
application area is gated behind a login wall. Access is invitation-only:
admins create user accounts; there is no public signup. Because the only
reason to visit elinnoagent.com is to log in, the welcome page itself
**is** the login surface — the email + password form sits inside the
existing dark hero, with no detour to a separate `/login` URL.

## 2. Background

elinnoagent.com is currently a static "coming soon" site on Cloudflare Pages.
The roadmap calls for it to become a full application; user accounts are the
next milestone before any real product features can ship. Because the product
is being seeded with a small, controlled set of early users, self-serve signup
is out of scope for now and would create unnecessary noise (spam accounts,
abandoned signups, support overhead).

## 3. Goals

1. Gate everything behind login except the welcome page itself.
2. Let an administrator create, list, and remove users from a web UI.
3. Let users recover access via an email-based password reset.
4. Match the existing visual identity (DESIGN.md) so the auth surfaces feel
   like part of the same product.
5. Use only the existing stack — Cloudflare Pages, D1, Pages Functions — to
   avoid adding a new vendor or build step.

## 4. Non-goals

- Public self-serve signup.
- Social login (Google, GitHub, etc.).
- Two-factor authentication.
- Single sign-on, SAML, OIDC.
- Account lockout after N failed logins (relying on Cloudflare's edge
  protection for now).
- Audit logging of admin actions.
- Email verification on user creation (admin is trusted to enter correct emails).
- A "change my own password while logged in" flow (users go through forgot-password instead).
- A rich user profile (avatars, names, roles beyond admin/non-admin).

These are deliberate omissions for v1 and may be added later.

## 5. Users & roles

There are exactly two roles:

| Role | Capabilities |
|---|---|
| **User** | Sign in, sign out, reset password, view dashboard. |
| **Admin** | Everything a user can do, plus: list users, create users, delete users. |

The role is a single boolean (`is_admin`) on the `users` row. There is no
hierarchy of admins; any admin can do anything an admin can do, including
removing other admins (with one safety guard, see §10).

## 6. User stories

- As a visitor, I land on the welcome page and see a "Sign in" link in the nav.
- As an invited user, I receive my email and a temporary password from an admin out-of-band, sign in at `/login.html`, and land on `/dashboard.html`.
- As a user who's forgotten my password, I click "Forgot password?", submit my email, receive a reset link, set a new password, and sign in.
- As an admin, I sign in and land on `/admin.html` where I can see all users, add new ones, and remove existing ones.
- As an admin, I can promote a new user to admin at creation time.
- As any signed-in user, I can sign out from the top-right of the app nav and return to the login screen.

## 7. User flows

### 7.1 Sign in

```
Land on /  → email + password form is in the hero
              POST /api/login
              ├─ valid    → set session cookie → redirect /admin.html (admin) or /dashboard.html
              └─ invalid  → "Invalid email or password" inline error
```

If a user is already signed in when they land on `/`, the page redirects
them straight to their destination (`/admin.html` for admins, `/dashboard.html`
for users) without showing the form.

### 7.2 Forgot / reset password

```
/ → "Forgot password?" → /forgot-password.html
              email
              POST /api/forgot-password
              → always shows "If an account exists, a reset link is on its way."
              (Server only sends an email if the email actually matches a user.)

email link → /reset-password.html?token=...
              new password ×2
              POST /api/reset-password
              ├─ token valid + unused + unexpired → update password, invalidate all sessions for that user → redirect /
              └─ otherwise → "This reset link is invalid or has expired."
```

### 7.3 Admin: add user

```
/admin.html → "Add user" form: email, initial password, [admin] checkbox
              POST /api/admin/users
              ├─ ok      → row added, table refreshes, success message
              ├─ exists  → 409 "A user with this email already exists"
              └─ invalid → 400 with reason
```

The admin reads the password back from the form and shares it with the new
user out-of-band (chat/email/in person). The new user can immediately sign
in, or use the forgot-password flow to set a password the admin never sees.

### 7.4 Admin: remove user

```
Admin clicks "Remove" on a row → confirm dialog → DELETE /api/admin/users/:id
                                                    → row deleted, sessions cascade
```

Two server-side guards (see §10):
1. You cannot remove yourself.
2. You cannot remove the last admin.

## 8. Functional requirements

### 8.1 Authentication

- Sessions are server-side rows in a `sessions` table, keyed by an opaque random token (32 bytes, base64url).
- The token is stored in a cookie named `ea_session` with `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Session lifetime: 7 days from creation. No sliding renewal in v1.
- Logout deletes the row and clears the cookie.
- Resetting your password invalidates all your other sessions.

### 8.2 Password handling

- Passwords are hashed with PBKDF2-SHA256, 310,000 iterations (OWASP 2023 minimum), 16-byte random salt.
- Stored format: `pbkdf2$<iterations>$<salt_b64>$<hash_b64>`.
- Verification is constant-time. On a missing-user login attempt, the server hashes the submitted password against a dummy hash anyway, to keep timing roughly equal whether or not the email exists.
- Minimum length: 8 characters. No upper bound on character classes; users may pick whatever they like (passphrases are encouraged).
- Maximum length: 256 characters (defensive against DoS via giant-password hashing).

### 8.3 Password reset

- Tokens: 32 random bytes, base64url-encoded, single-use, 1-hour TTL.
- Stored in a `password_resets` table with `expires_at` and `used_at`.
- Forgot-password endpoint always returns `200 OK` regardless of whether the email matched a user, to prevent account enumeration.
- Reset email is sent via Resend (HTTP API). Subject: "Reset your Elinno Agent password". HTML + plain-text bodies, both included in every send.
- Reset link format: `https://elinnoagent.com/reset-password.html?token=<token>`.
- Successful reset: updates the password, marks the token used, deletes all of that user's existing sessions (forces re-login everywhere).

### 8.4 Admin

- Admin endpoints check `is_admin` on every request; failure returns 403.
- List endpoint returns all users sorted by creation date, descending.
- Create endpoint rejects duplicate emails (409) and invalid input (400).
- Delete endpoint cascades to that user's sessions and password_resets rows (via `ON DELETE CASCADE` foreign keys).

### 8.5 Welcome page

- The welcome page (`/`) is the login surface. It keeps the existing dark hero
  composition (background gradient, drifting orbs, purple mix-blend wash, glass
  nav) and embeds the email + password form directly inside the hero, in place
  of the previous "coming soon" description paragraph.
- The headline is "Welcome back" (matching the hero's existing two-weight
  treatment: regular + semibold span).
- Form styling lives in `styles.css` under `.hero-login`. Inputs use a
  translucent dark variant (frosted glass on the dark hero) instead of the
  light-grey field treatment used on `/admin.html`.
- The page sets `<meta name="robots" content="noindex">` because it is
  effectively a login screen, not a marketing page.
- The standalone `/login.html` route is preserved as a redirect to `/` so
  any old bookmarks or links from previous code continue to work.

## 9. Non-functional requirements

### 9.1 Privacy

- The forgot-password endpoint never reveals whether an email is registered.
- Login errors are generic ("Invalid email or password") regardless of which half was wrong.
- No analytics, tracking, or third-party scripts on auth pages.
- Auth pages set `<meta name="robots" content="noindex">`.

### 9.2 Security

- All auth pages are served over HTTPS (Cloudflare-enforced).
- Cookies are `Secure; HttpOnly; SameSite=Lax`.
- The `RESEND_API_KEY` is stored as a Cloudflare secret, never in the repo or in client code.
- All user-supplied input is parameterized in SQL via D1's prepared statements.
- The dashboard and admin pages are gated client-side (redirect to login if `/api/me` returns no user) and server-side (every admin endpoint re-checks the session and admin flag).
- The session table has an index on `expires_at` for periodic cleanup later.

### 9.3 Performance

- Pages Functions cold start: ~50ms; D1 query latency: typically 5–30ms in the same region.
- Login is dominated by PBKDF2 verification (~50–100ms at 310k iterations on Workers). Acceptable for a v1.
- Welcome page must remain fast to first paint; the only addition is one anchor and a small CSS block, no extra script.

### 9.4 Reliability

- A failed Resend send during forgot-password is logged but does not surface to the client (to preserve enumeration resistance).
- If the database is unreachable, endpoints return 500 and the UI shows "Network error." (No graceful offline mode in v1.)
- Production deploy is atomic via Cloudflare Pages; rollback is one click in the dashboard.

### 9.5 Accessibility

- All form fields have associated `<label>` elements.
- Buttons and links have visible focus states (browser default not overridden).
- Error and success messages are rendered as text in the same flow, not as alerts or toasts.
- Color contrast meets WCAG AA against the chosen palette (purple `#6234fc` on white is 4.6:1).

## 10. Edge cases & guards

| Case | Behavior |
|---|---|
| Already signed in, visit `/` | Auto-redirect to `/dashboard.html` (or `/admin.html` for admins). |
| Non-admin signs in, visits `/admin.html` | Auto-redirect to `/dashboard.html`. |
| Anonymous visit to `/dashboard.html` or `/admin.html` | Auto-redirect to `/`. |
| Visit to `/login.html` (legacy) | Auto-redirect to `/`. |
| Admin tries to delete themselves | 400, "You cannot delete your own account." |
| Admin tries to delete the last remaining admin | 400, "Cannot delete the last admin." |
| Reset token reused | 400, "This reset link is invalid or has expired." |
| Reset token expired | Same response; no distinction. |
| Email not in DB on forgot-password | 200 OK, no email sent, no signal to client. |
| Duplicate email on user creation | 409, "A user with this email already exists." |
| Password < 8 chars on creation or reset | 400 with reason. |
| Resend API key missing | Forgot-password still returns 200; error is logged server-side. |

## 11. Data model

### `users`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment. |
| email | TEXT | Unique, case-insensitive (`COLLATE NOCASE`). |
| password_hash | TEXT | `pbkdf2$<iters>$<salt>$<hash>`. |
| is_admin | INTEGER | 0 or 1. |
| created_at | INTEGER | Unix seconds. |
| updated_at | INTEGER | Unix seconds. Bumped on password change. |

### `sessions`
| Column | Type | Notes |
|---|---|---|
| token | TEXT PK | 32 random bytes, base64url. |
| user_id | INTEGER FK | `ON DELETE CASCADE`. |
| created_at | INTEGER | Unix seconds. |
| expires_at | INTEGER | Unix seconds. Indexed. |

### `password_resets`
| Column | Type | Notes |
|---|---|---|
| token | TEXT PK | 32 random bytes, base64url. |
| user_id | INTEGER FK | `ON DELETE CASCADE`. |
| created_at | INTEGER | Unix seconds. |
| expires_at | INTEGER | created_at + 3600. |
| used_at | INTEGER | NULL until consumed. |

## 12. API surface

All endpoints return JSON. All non-GET endpoints expect `application/json`.

| Method | Path | Auth | Body | 200 response |
|---|---|---|---|---|
| POST | `/api/login` | none | `{email, password}` | `{ok:true, user:{id,email,is_admin}}`, `Set-Cookie: ea_session` |
| POST | `/api/logout` | session | — | `{ok:true}`, clears cookie |
| GET  | `/api/me` | optional | — | `{user: {...} \| null}` |
| POST | `/api/forgot-password` | none | `{email}` | `{ok:true}` (always) |
| POST | `/api/reset-password` | none | `{token, password}` | `{ok:true}` |
| GET  | `/api/admin/users` | admin | — | `{users: [...]}` |
| POST | `/api/admin/users` | admin | `{email, password, is_admin?}` | `{ok:true, user:{...}}` |
| DELETE | `/api/admin/users/:id` | admin | — | `{ok:true}` |

## 13. UI surfaces

| Page | Purpose |
|---|---|
| `/` | The welcome page **and** the login surface. Email + password form embedded in the dark hero. |
| `/forgot-password.html` | Single-field email form. Always shows neutral confirmation. |
| `/reset-password.html` | New + confirm password form. Reads `?token=` from URL. |
| `/dashboard.html` | Placeholder protected page. Will host the real product. |
| `/admin.html` | User management table + add-user form. Admin-only. |
| `/login.html` | Legacy alias. Redirects to `/`. Kept so old bookmarks don't 404. |

The four protected/auxiliary pages (`forgot-password`, `reset-password`,
`dashboard`, `admin`) share `auth.css`, kept separate from the welcome
page's `styles.css` so the two stylesheets never fight each other. The
welcome page's in-hero form styles live in `styles.css` (under
`.hero-login`) since they belong with the rest of the hero composition.

## 14. Operational requirements

Before launch the operator (Jenny) must complete steps documented in `SETUP.md`:

1. Create D1 database `elinno-agent-db` and bind to Pages project as `DB`.
2. Apply `schema.sql` to D1.
3. Verify `elinnoagent.com` in Resend; create an API key scoped to that domain.
4. Add Cloudflare environment variables: `RESEND_API_KEY` (secret), `MAIL_FROM`, `SITE_URL`.
5. Run `node scripts/seed-admin.mjs jenny@elinnovation.net <temp-password>` and execute the printed SQL against the remote D1 to create the first admin.
6. Push to `main` to deploy.

## 15. Acceptance criteria

The system is considered shipped when all of the following are true on production:

- [ ] Visiting `elinnoagent.com` shows the dark hero with the embedded email + password form.
- [ ] The seeded admin's credentials sign in and redirect to `/admin.html`.
- [ ] `/admin.html` lists the seeded admin and allows creating a non-admin user.
- [ ] The newly created non-admin can sign in and lands on `/dashboard.html`.
- [ ] The non-admin visiting `/admin.html` directly is redirected to `/dashboard.html`.
- [ ] Forgot-password sends a real email to the seeded admin's inbox; the link works; password update succeeds; old sessions are invalidated.
- [ ] Deleting a user from `/admin.html` removes them from the list and prevents them from signing in.
- [ ] Deleting yourself or the last admin is blocked with a clear message.
- [ ] All auth pages render correctly on mobile (≤425px) and desktop, matching DESIGN.md tokens.
- [ ] Visiting `/login.html` directly redirects to `/`.

## 16. Future work (post-v1, not committed)

- Self-serve "change password while signed in" flow.
- Email change with verification.
- Rate limiting on `/api/login` and `/api/forgot-password` (IP-based, with Turnstile fallback).
- Account lockout after N failed attempts.
- Audit log of admin actions.
- Two-factor authentication (TOTP).
- Password complexity policy.
- "Remember me" longer sessions vs. short default.
- Public self-serve signup with email verification.
- Profile fields (display name, avatar) and per-user settings.
