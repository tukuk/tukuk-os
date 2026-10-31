---
name: cloudflare-tunnel
description: Inspect the single Cloudflare Tunnel that serves tukuk.org and its routes
---
# Cloudflare Tunnel — current state

## The rule

ONE tunnel, ONE connector, ONE config file:

- tunnel `87e7e77f-d6e0-410b-bbcb-dd74ae3a49ae` (`tukuk-os-v2`)
- unit `cloudflared.service`
- config `/etc/cloudflared/config.yml`

Every hostname is a **route on that tunnel**, added in Zero Trust → Networks → Routes.
Do not create a second tunnel. The legacy `a3af5bb4` ("build-tukuk") did exactly that and
is retired: it needed its own credential, its own unit, and its own thing to forget on a
rebuild — and forgetting it 530'd three live hostnames.

## Configuration

- **TOKEN mode** (no `.json`): the token in `.env` / `deploy/env.defaults` is enough.
- In token mode cloudflared **IGNORES the local `ingress:` block** — the edge (dashboard)
  decides routing. `deploy/cloudflared/config.yml` is therefore the canonical *list*, not
  the source of truth. Keep the two in step: `node scripts/cloudflared-audit.js`.
- Origin: nginx on `127.0.0.1:3000` (Node moves to `:3001` after the front-proxy
  cut-over; the tunnel never has to change). `build.tukuk.org` is the one exception →
  `127.0.0.1:5174`, the wake front door that fronts the builder on `:5176`.
- `deploy/cloudflared/gcp-config.yml` is the failover MIRROR on a Google Cloud VM. A
  different machine in a different provider, on purpose. It is never installed here.

## Routes

| hostname | target | notes |
|---|---|---|
| `tukuk.org` | `localhost:3000` | site; admin panel is `/admin` on this host |
| `www.tukuk.org` | `localhost:3000` | edge redirects to the apex |
| `tchat.tukuk.org` | `localhost:3000` | `TCHAT_HOST` gate in `src/server.js` |
| `agent.tukuk.org` | `127.0.0.1:8443` | Tukuk Agent (code-server) |
| `play.tukuk.org` | `localhost:3000` | Godot build, own nginx block (needs COOP/COEP) |
| `build.tukuk.org` | `127.0.0.1:5174` | Builder, via the wake front door |

Retired: `dashboard.tukuk.org` (panel is `/admin` on the apex), `api.tukuk.org`,
`mqtt.tukuk.org`.

## Commands

- `sudo systemctl restart cloudflared` — restart the connector
- `sudo systemctl status cloudflared` — status
- `journalctl -u cloudflared -f` — live log
- `sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate`

## Checks

- `node scripts/cloudflared-audit.js` — repo list vs the live edge, and how many tunnels
  exist. Exit 0 in step, 1 drift, 2 the API token lacks Tunnel:Read.
- `bash scripts/public-canary.sh` — proves the public site from OUTSIDE the box
  (0 healthy, 1 wrong, 2 edge down).
