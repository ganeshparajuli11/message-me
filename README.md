# Inkwell — private 1:1 chat

Real-time, one-to-one chat with username signup, WhatsApp-style delivery/read
ticks, typing indicators, presence, image messages, block/report, and an admin
panel that can never see message content. Built to the project spec
(`chat-app-project-spec.md`) as a sellable, self-hosted product: one VPS bill,
no metered SaaS anywhere in the stack.

Stack: Next.js (App Router, TypeScript) · Convex (self-hosted, Docker) ·
Tailwind CSS v4 · Convex Auth (username + password, open source, runs inside
the Convex deployment — no auth vendor).

---

## Local development

1. Start a self-hosted Convex backend (Docker required):

   ```bash
   cd deploy
   cp env.example .env        # defaults are fine locally
   docker compose up -d
   docker compose exec backend ./generate_admin_key.sh
   ```

2. Configure the app:

   ```bash
   cp .env.local.example .env.local   # paste the admin key from step 1
   npm install
   ```

3. Set the Convex Auth JWT keys (one-time):

   ```bash
   cd deploy && npm i jose && node generateKeys.mjs
   # copy both output lines, then set them on the deployment:
   npx convex env set JWT_PRIVATE_KEY "<value>"
   npx convex env set JWKS '<value>'
   npx convex env set SITE_URL http://localhost:3000
   ```

4. Push functions and run:

   ```bash
   npx convex dev      # terminal 1 — pushes convex/ and watches
   npm run dev         # terminal 2 — Next.js on http://localhost:3000
   ```

5. Create your account in the app, then make it admin:

   ```bash
   npx convex run admin:promoteToAdminByUsername '{"username":"yourname"}'
   ```

The Convex dashboard runs at http://localhost:6791 (use the admin key).

## Production deployment (buyer's VPS)

Follows spec Section 9 — self-hosted Convex only, never Convex Cloud.

1. Provision a VPS (Hetzner/DigitalOcean etc.) with Docker + a reverse proxy
   (Caddy or nginx) terminating TLS.
2. Copy `deploy/` to the server, fill in `.env` (real domains + a strong
   `INSTANCE_SECRET`), `docker compose up -d`.
3. Generate the admin key on the server (step 1 above) and set the Convex Auth
   env vars (step 3 above) against the production URL, with
   `SITE_URL=https://app.your-domain.com`.
4. From your machine or CI, push functions:
   `CONVEX_SELF_HOSTED_URL=... CONVEX_SELF_HOSTED_ADMIN_KEY=... npx convex deploy`
5. Build and run the Next.js frontend on the same VPS (PM2 or Docker) with
   `NEXT_PUBLIC_CONVEX_URL=https://convex.your-domain.com`, or any static host
   the buyer prefers.
6. Hand over: server access, `deploy/docker-compose.yml`, the `.env`, admin
   key, and this README. Restart everything with `docker compose restart`;
   view logs with `docker compose logs -f backend`.

Encryption: TLS in transit via the reverse proxy; at rest via the self-hosted
storage layer/volume (disk-level encryption on the VPS). Application-level
AES-256-GCM on message text was deliberately **not** added (spec Section 8
lists it as a stretch goal — documented here, not silently added or skipped).

## Architecture notes

- `convex/schema.ts` — spec Section 4, field names/types exact.
- `convex/lib/helpers.ts` — `requireUser`/`requireAdmin`; every function derives
  identity from the session, never from client args.
- Blocking is enforced server-side inside `sendMessage` and
  `createConversation`.
- Rate limits: 20 messages/10s per user (global, `by_sender` index); 1 report
  per reporter per target per 24h.
- Read receipts compare each message's `createdAt` with the other participant's
  `conversationReads.lastReadAt` — no per-message read flags (spec Section 6).
- Typing rows are considered live for 3s; no clear-typing call.
- `convex/admin.ts` never imports or queries `messages` — the admin panel
  structurally cannot access message content (spec Sections 5/8/11).

## Spec deviations (flagged, not silent)

1. **Two extra indexes, zero field changes.** Section 4's own rule ("every
   query must use an index — no unindexed full scans") cannot be satisfied for
   two required features with the listed indexes alone, so these were added:
   `messages.by_sender` (global 20/10s rate limit, Section 8) and
   `conversationReads.by_user` (listConversations, Section 5).
2. **`warnUser` does not persist.** The Section 4 schema has no field/table
   for warnings and inventing schema is forbidden. The mutation validates and
   succeeds but stores nothing. **Owner decision needed** before shipping:
   add a `warnings` table (or `warnedAt` field), or drop the button.
3. **Auth = Convex Auth (username + password).** Spec left auth open with a
   "no metered SaaS" constraint; Convex Auth is open source and runs entirely
   inside the self-hosted deployment. Its Password provider uses an `email`
   field as the account identifier — we store the lowercase username there; no
   email addresses are collected. Convex Auth's own tables and optional user
   fields are added to the schema (library requirement).
4. **Tailwind v4.** "Latest stable" Tailwind is CSS-first: the Ink & Paper
   tokens live in `@theme` in `src/app/globals.css` instead of
   `tailwind.config.ts`. Same tokens, new location.
5. **UI components are hand-copied shadcn-style files** in
   `src/components/ui/` (the shadcn CLI registry was unreachable from the
   build sandbox). Same copy-into-repo model the spec wanted; you can re-run
   `npx shadcn@latest init` later if desired.
6. **Report rate limiting is per-target** (1/24h per reporter per target). A
   global per-reporter cap would need a `by_reporter` index — say the word.
7. **"Delivered" ticks** use the spec's "treat as automatic" allowance:
   a message shows double-gray once the recipient has been online since it was
   sent, colored (clay) once read. The `messages.status` field stays `"sent"`
   in the DB; read state is computed from `conversationReads` per Section 6.
8. **Admin "message search"** (Section 2) is implemented as search over report
   reasons/snapshots only — full message search would violate the
   admins-never-see-messages boundary (Sections 5/8/11), and the reporter's
   voluntary snapshot is the only message text admins legitimately hold.

## Project layout

```
convex/               backend functions (schema, auth, messages, admin…)
src/app/              Next.js pages (chat at /, admin at /admin)
src/components/       UI (chat/, admin/, auth/, ui/ primitives)
deploy/               docker-compose for self-hosted Convex + key scripts
```
