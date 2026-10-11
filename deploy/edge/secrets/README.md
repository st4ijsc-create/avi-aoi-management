# deploy/edge/secrets — never put a real credential here

Everything in this folder except this README is ignored by git (`.gitignore`), so a file dropped here by mistake is not
committed. That is a safety net, not the place for the secret.

Keep the edge node credential (`edn_….…`) **outside the repo checkout**, e.g. `/etc/avi-edge/edge-node.cred`:

```bash
sudo install -d -m 700 /etc/avi-edge
sudo install -m 600 -o <app uid> edge-node.cred /etc/avi-edge/edge-node.cred   # uid: docker compose run --rm --entrypoint id edge-gateway
export EDGE_NODE_CREDENTIAL_HOST_FILE=/etc/avi-edge/edge-node.cred
```

Windows host: `icacls C:\avi-edge\edge-node.cred /inheritance:r /grant:r "<gateway account>:R"`.

See `docs/EDGE_GATEWAY.md` §8.2–8.3 and `deploy/edge/docker-compose.edge.execution.yml`.
