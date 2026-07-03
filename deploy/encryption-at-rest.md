# Encryption at rest (polish Section 6 — Option A, as recommended)

Decision: media/message content is protected at the INFRASTRUCTURE layer,
not with application-level file encryption (Option B). Rationale, per the
polish prompt: the stated concern — "admins must not casually read message
media" — is already structurally enforced in the app (`convex/admin.ts` can
never query messages), and disk-level encryption protects everything
(text, images, voice notes, DB, backups) with zero app-code complexity.
Application-level encryption of binary media (Option B) would require a
custom authenticated decrypt-and-stream HTTP action replacing every storage
URL, plus real key management — if a compliance requirement ever demands it,
treat it as its own dedicated project, not a polish item.

Per the scope clarification: profile pictures are exempt (they're served by
Clerk anyway).

## What to do on the buyer's VPS

Pick ONE of these; both make stolen disks/backups unreadable:

### Option A1 — Full-disk encryption (simplest to reason about)
Most VPS providers (Hetzner, DigitalOcean) support installing with an
encrypted root volume, or offer encrypted block storage volumes:

- Hetzner/DO block volume: create the volume with encryption enabled, mount
  it, and point Docker's data root (or just the Convex volume) at it.
- Bare metal / custom images: use LUKS at install time.

### Option A2 — Encrypted volume just for Convex data (targeted)
```bash
# one-time setup on the VPS (requires cryptsetup)
fallocate -l 20G /var/inkwell-data.img
cryptsetup luksFormat /var/inkwell-data.img          # choose a strong passphrase
cryptsetup open /var/inkwell-data.img inkwell-data
mkfs.ext4 /dev/mapper/inkwell-data
mkdir -p /mnt/inkwell-data
mount /dev/mapper/inkwell-data /mnt/inkwell-data
```
Then bind the Convex Docker volume to it — in `deploy/docker-compose.yml`:
```yaml
volumes:
  data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/inkwell-data
```
After a reboot the volume must be unlocked (`cryptsetup open` + `mount`)
before `docker compose up` — keep the passphrase in the buyer's password
manager, NOT on the server.

## What this does and does not protect

- ✔ Stolen/copied disk, discarded hardware, leaked raw backups: unreadable.
- ✔ Backups: snapshot the encrypted image file, stays encrypted.
- ✘ Someone with live admin/API access to the RUNNING deployment can still
  query data — that's what the `admin.ts` boundary and the deployment admin
  key protect. Keep the admin key secret and rotate it on handover.

Also ensure TLS in transit (reverse proxy) — already covered in the main
deployment steps.
