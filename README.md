# Inkwell - private 1:1 chat

Real-time, one-to-one chat with Clerk sign-in, username profiles, delivery/read
ticks, typing indicators, presence, image messages, block/report, and an admin
panel that can never see message content.

Stack: Next.js App Router, TypeScript, self-hosted Convex, Tailwind CSS v4, and
Clerk authentication.

## Local Development

1. Start a self-hosted Convex backend:

   ```bash
   cd deploy
   cp env.example .env
   docker compose up -d
   docker compose exec backend ./generate_admin_key.sh
   ```

2. Configure the app:

   ```bash
   cp .env.local.example .env.local
   npm install
   ```

3. Configure Clerk:

   - Create a Clerk app and activate the Convex integration:
     https://dashboard.clerk.com/apps/setup/convex
   - Copy the Clerk publishable key and secret key into `.env.local`.
   - Copy the Clerk Frontend API URL into `.env.local` as
     `CLERK_JWT_ISSUER_DOMAIN`.
   - Set the same issuer on Convex:

     ```bash
     npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://your-clerk-frontend-api-url"
     ```

4. Push functions and run:

   ```bash
   npx convex dev
   npm run dev
   ```

5. Sign in with a Clerk account that has a username, then make it admin:

   ```bash
   npx convex run admin:promoteToAdminByUsername '{"username":"yourname"}'
   ```

The Convex dashboard runs at http://localhost:6791 when using the local
self-hosted stack.

## Production Deployment

1. Provision a VPS with Docker and a reverse proxy terminating TLS.
2. Copy `deploy/` to the server, fill in `.env`, and run `docker compose up -d`.
3. Generate the admin key on the server, configure the production Clerk app and
   domain, activate Clerk's Convex integration, and set the production Clerk
   Frontend API URL as `CLERK_JWT_ISSUER_DOMAIN` in Convex.
4. Push functions:

   ```bash
   CONVEX_SELF_HOSTED_URL=... CONVEX_SELF_HOSTED_ADMIN_KEY=... npx convex deploy
   ```

5. Build and run the Next.js frontend with
   `NEXT_PUBLIC_CONVEX_URL=https://convex.your-domain.com` plus the production
   Clerk keys.

## Architecture Notes

- `convex/schema.ts` stores app profile rows keyed by Clerk-backed
  `identity.tokenIdentifier`.
- `convex/lib/helpers.ts` centralizes `requireUser` and `requireAdmin`; backend
  functions derive identity from the authenticated session.
- Clerk owns sign-in/session management; Convex validates Clerk JWTs through
  `convex/auth.config.ts`.
- Blocking is enforced server-side inside `sendMessage` and
  `createConversation`.
- Rate limits: 20 messages per 10 seconds per user, plus 1 report per reporter
  per target per 24 hours.
- `convex/admin.ts` never imports or queries `messages`, so the admin panel
  cannot access private message content.

## Project Layout

```text
convex/               backend functions (schema, users, messages, admin...)
src/app/              Next.js pages (chat at /, admin at /admin)
src/components/       UI (chat/, admin/, auth/, ui/ primitives)
deploy/               docker-compose for self-hosted Convex
```
