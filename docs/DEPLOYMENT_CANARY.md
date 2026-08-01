# Shadow → Canary deployment for the app (GitOps)

doc 44 W6-4 · gap G5.25 · SYNAPSE_Tang5 Ch.15 (GitOps / progressive delivery)

The AI-model and fleet-command paths already ship a shadow → canary promotion gate
(observe-only shadow, then a small live canary, then full rollout). This document
extends the same idea to the **application deployment** itself, using the GitOps
`ApplicationSet` pattern introduced in W0-H, and wires it to the health probes and DORA
feed added in this batch.

> Status: **design + seam**. The app exposes the gates (`/livez`, `/readyz`) and the
> measurement feed (DORA `deployment_events` + `dora` router). The ArgoCD/Argo-Rollouts
> manifests below are the recommended operator wiring — they live in the deploy repo, not
> in this application repo.

---

## 1. Health probes (in this repo)

Two Kubernetes/ArgoCD-standard probes, split from the legacy `/health`
(`server/_core/healthProbes.ts`, wired in `server/_core/index.ts`):

| Probe      | Semantics                                                   | Gate behaviour |
| ---------- | ---------------------------------------------------------- | -------------- |
| `GET /livez`  | Process is up. **No dependency checks.** Always `200` unless the event loop is dead. | Liveness — a DB blip must **not** restart the pod. |
| `GET /readyz` | Can this instance serve traffic? **DB is the hard gate**; broker state is reported but not gated (MQTT may be intentionally off). | Readiness — the canary is held out of the Service until it flips `200`. |

`/health` is unchanged (rich diagnostics for humans / Docker `HEALTHCHECK`).

```yaml
# pod spec (deploy repo)
livenessProbe:
  httpGet: { path: /livez, port: 3000 }
  initialDelaySeconds: 20
  periodSeconds: 15
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
```

## 2. Shadow stage

Deploy the new revision with **0 % live traffic** and traffic *mirrored* to it
(Istio/NGINX `mirror`, or Argo-Rollouts `setMirrorRoute`). The shadow instance:

- must pass `/readyz` before any mirror starts,
- receives a copy of production requests (responses discarded),
- is watched via the SLO burn-rate evaluator (`observabilityRouter`) and error logs.

Every request already carries a `correlation_id` (G5.17) end-to-end, so a shadow
regression is traceable "nút bấm → lệnh → máy" across the mirrored path.

## 3. Canary stage (ApplicationSet)

Promote from shadow to a small live slice (e.g. 5 % → 25 % → 50 % → 100 %) using an
Argo-Rollouts `Rollout` with analysis, generated per-environment by an `ApplicationSet`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: { name: avi-aoi }
spec:
  generators:
    - list:
        elements:
          - env: staging
          - env: production
  template:
    metadata: { name: 'avi-aoi-{{env}}' }
    spec:
      project: default
      source:
        repoURL: https://git.example/deploy/avi-aoi
        targetRevision: main
        path: 'overlays/{{env}}'
      destination: { name: '{{env}}-cluster', namespace: avi-aoi }
      syncPolicy: { automated: { prune: true, selfHeal: true } }
```

```yaml
# Rollout (overlays/<env>) — canary steps gated on readiness + analysis
strategy:
  canary:
    steps:
      - setWeight: 5
      - pause: { duration: 5m }
      - analysis: { templates: [{ templateName: canary-http-slo }] }
      - setWeight: 25
      - pause: { duration: 10m }
      - setWeight: 50
      - pause: { duration: 10m }
      - setWeight: 100
```

The `canary-http-slo` `AnalysisTemplate` should abort/rollback on: readiness flapping,
elevated 5xx rate, or an SLO burn-rate breach (Prometheus `/metrics` + burn-rate rules
from `sloAlerting`). An aborted canary is an **automatic rollback**.

## 4. Feeding DORA

Every promotion, abort, and rollback is a DORA signal. Emit a `deployment_events` row
(migration `0267`) so the four DORA keys stay live (`dora` tRPC router, `DORA_ENABLED`):

- **success** — canary reached 100 % and stayed healthy.
- **failed** — canary aborted before promotion.
- **rolled_back** — a promoted revision was rolled back.

Wire it from the CD pipeline (ArgoCD post-sync hook, or a CI step) via the admin
`dora.record` mutation, e.g.:

```jsonc
// dora.record input
{
  "version": "1.4.2",
  "commitSha": "cf9da549",
  "environment": "production",
  "status": "success",
  "leadTimeMs": 5400000   // commit → production (optional; CI computes it)
}
```

`meanTimeToRestore` is derived from the failure → next-success interval in the same
environment; an incident/andon resolution feed can supplement it later. When
`DORA_ENABLED` is off (default) the write no-ops and metrics honestly report `no_data`.

## 5. Env flags (owner)

| Flag / var           | Default | Purpose |
| -------------------- | ------- | ------- |
| `DORA_ENABLED`       | off     | Enable the `dora.record` write path (reads always work). |

The probes (`/livez`, `/readyz`) and correlation enrichment are **not** flag-gated —
they are additive and safe to expose immediately.
