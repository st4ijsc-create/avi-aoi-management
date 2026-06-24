# EMQX (single-node, TLS) — Phase 1 WS1.3/1.4

The platform's **embedded aedes** broker still serves AOI/AVI machine clients.
EMQX here is the **UNS broker** the app publishes normalized ISA-95 / Sparkplug-B
messages to (`server/services/unsPublisher.ts`). Single node with TLS now;
clustering/HA is a later step.

## Run

```bash
# 1) Dev certs (or place real CA-signed certs into ./certs as ca.crt/server.crt/server.key)
bash deploy/emqx/certs/generate-certs.sh

# 2) Start EMQX
docker compose -f deploy/emqx/docker-compose.emqx.yml up -d

# 3) Create the publish user (dashboard http://localhost:18083, default admin/public)
#    or via the HTTP API. Then set the app env below.
```

## App wiring (.env)

```env
UNS_BRIDGE_ENABLED=true
UNS_BROKER_URL=mqtts://localhost:8883
UNS_TLS_CA=deploy/emqx/certs/ca.crt        # trust the dev CA
# UNS_TLS_REJECT_UNAUTHORIZED=false         # dev-only alternative to a CA file
UNS_BROKER_USERNAME=avi_uns
UNS_BROKER_PASSWORD=change_me
# Optional Sparkplug B:
# UNS_SPARKPLUG_ENABLED=true
```

The app reads `mqtts://` and applies TLS options (CA / rejectUnauthorized) in
`unsPublisher.ts`.

## Security notes

- Change the EMQX dashboard password and the node cookie immediately.
- `EMQX_ALLOW_ANONYMOUS=false` — create a dedicated publish user with minimal
  topic ACLs (publish-only to the UNS namespace).
- Plain `1883` is exposed for convenience; disable it for a TLS-only posture.
- Certs are git-ignored (`certs/.gitignore`) — never commit private keys.
- For production use certificates from your internal PKI / a real CA, not the
  dev self-signed script.
