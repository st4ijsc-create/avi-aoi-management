/**
 * Observability bootstrap (QW4 / GAP G11).
 *
 * Optional, feature-flagged integrations:
 *  - Sentry error tracking   — enabled when SENTRY_DSN is set.
 *  - OpenTelemetry tracing   — enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * All packages are imported dynamically via variable specifiers so the build
 * succeeds even when @sentry/node / @opentelemetry/* are not installed. When a
 * package or its env flag is missing the corresponding integration is a no-op.
 *
 * To enable:
 *   Sentry: pnpm add @sentry/node && set SENTRY_DSN=...
 *   OTel:   pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
 *                    @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources \
 *                    @opentelemetry/semantic-conventions
 *           set OTEL_ENABLED=true
 *           set OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318/v1/traces
 *           (optional) OTEL_SERVICE_NAME=avi-aoi   OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
 *
 * doc 37 C1 — the OTLP exporter is now "ready to plug a collector": gated by OTEL_ENABLED, it
 * reads OTEL_EXPORTER_OTLP_ENDPOINT (default the OTLP/HTTP traces path on localhost:4318), stamps a
 * service.name resource, and lights up the SYNAPSE correlation→span bridge. It stays an HONEST
 * degrade — with the @opentelemetry packages absent it warns once and no-ops (no npm dep added).
 */

let initialized = false;

export async function initObservability(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await initSentry();
  await initOpenTelemetry();
  // doc 37 C1 — start the SLO burn-rate evaluator + alert bridge (flag-gated inside; no-op when
  // OBSERVABILITY is off or no observation provider is registered). Never throws into startup.
  try {
    const { startSloEvaluator } = await import("../services/observability/sloAlerting");
    startSloEvaluator();
    // doc 38 Đợt P (P0-A) — register the HTTP-derived observation feed for every catalogue SLO so
    // the evaluator has REAL (good,total) short/long windows to burn against. No-op when
    // OBSERVABILITY is off (evaluator is off too). Must run AFTER startSloEvaluator so the loop is
    // already scheduled to pick up the freshly-registered providers on its next tick.
    const { installSloMetricsProviders } = await import("../services/observability/sloMetricsProvider");
    installSloMetricsProviders();
  } catch (err: any) {
    console.error("[Observability] SLO evaluator start failed:", err?.message ?? err);
  }
}

/** OTel is enabled when OTEL_ENABLED is truthy, OR (back-compat) an OTLP endpoint is set. */
function otelEnabled(): boolean {
  if (process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1") return true;
  // Back-compat: a bare endpoint (no flag) still activates, as the original scaffold did.
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_ENABLED !== "false";
}

/** Resolve the OTLP traces endpoint (explicit env wins; else the conventional OTLP/HTTP default). */
function otlpEndpoint(): string {
  const explicit = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (explicit) return explicit;
  return "http://localhost:4318/v1/traces";
}

async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const pkg = "@sentry/node";
    const Sentry: any = await import(pkg).catch(() => null);
    if (!Sentry) {
      console.warn("[Observability] SENTRY_DSN set but '@sentry/node' is not installed — skipping.");
      return;
    }
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    });
    console.log("[Observability] Sentry error tracking enabled.");
  } catch (err: any) {
    console.error("[Observability] Sentry init failed:", err?.message ?? err);
  }
}

async function initOpenTelemetry(): Promise<void> {
  if (!otelEnabled()) return;
  const endpoint = otlpEndpoint();

  try {
    const sdkPkg = "@opentelemetry/sdk-node";
    const autoPkg = "@opentelemetry/auto-instrumentations-node";
    const otlpPkg = "@opentelemetry/exporter-trace-otlp-http";

    const sdkMod: any = await import(sdkPkg).catch(() => null);
    const autoMod: any = await import(autoPkg).catch(() => null);
    const otlpMod: any = await import(otlpPkg).catch(() => null);

    if (!sdkMod || !autoMod || !otlpMod) {
      console.warn(
        `[Observability] OTEL_ENABLED but OpenTelemetry packages are not installed — OTLP export skipped ` +
          `(endpoint ${endpoint}). To activate: pnpm add @opentelemetry/sdk-node ` +
          `@opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http.`,
      );
      return;
    }

    const { NodeSDK } = sdkMod;
    const { getNodeAutoInstrumentations } = autoMod;
    const { OTLPTraceExporter } = otlpMod;

    // Optional resource (service.name) — best-effort; the SDK works without it.
    let resource: any;
    try {
      // Variable specifiers so tsc does not statically resolve these optional (not-installed) pkgs.
      const resPkg = "@opentelemetry/resources";
      const scPkg = "@opentelemetry/semantic-conventions";
      const resMod: any = await import(resPkg).catch(() => null);
      const scMod: any = await import(scPkg).catch(() => null);
      const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "avi-aoi";
      if (resMod?.Resource && scMod?.SemanticResourceAttributes) {
        resource = new resMod.Resource({
          [scMod.SemanticResourceAttributes.SERVICE_NAME]: serviceName,
          [scMod.SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? "0.0.0",
          [scMod.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? "development",
        });
      }
    } catch {
      /* resource is optional — proceed without it */
    }

    const sdk = new NodeSDK({
      ...(resource ? { resource } : {}),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    await sdk.start();
    // doc 33 §11 — light up the SYNAPSE correlation→span bridge so decisions/correlation ids ride
    // the OTLP export as first-class span attributes (no-op if OBSERVABILITY is off).
    await import("../services/observability/otelBridge").then((m) => m.initOtelBridge()).catch(() => undefined);
    console.log(`[Observability] OpenTelemetry tracing enabled → OTLP ${endpoint} (+ SYNAPSE correlation bridge).`);

    const shutdown = () => {
      sdk.shutdown().catch(() => undefined);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (err: any) {
    console.error("[Observability] OpenTelemetry init failed:", err?.message ?? err);
  }
}
