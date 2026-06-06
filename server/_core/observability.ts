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
 *                    @opentelemetry/exporter-trace-otlp-http
 *           set OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318/v1/traces
 */

let initialized = false;

export async function initObservability(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await initSentry();
  await initOpenTelemetry();
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
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    const sdkPkg = "@opentelemetry/sdk-node";
    const autoPkg = "@opentelemetry/auto-instrumentations-node";
    const otlpPkg = "@opentelemetry/exporter-trace-otlp-http";

    const sdkMod: any = await import(sdkPkg).catch(() => null);
    const autoMod: any = await import(autoPkg).catch(() => null);
    const otlpMod: any = await import(otlpPkg).catch(() => null);

    if (!sdkMod || !autoMod || !otlpMod) {
      console.warn(
        "[Observability] OTEL_EXPORTER_OTLP_ENDPOINT set but OpenTelemetry packages are not installed — skipping.",
      );
      return;
    }

    const { NodeSDK } = sdkMod;
    const { getNodeAutoInstrumentations } = autoMod;
    const { OTLPTraceExporter } = otlpMod;

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    await sdk.start();
    console.log("[Observability] OpenTelemetry tracing enabled.");

    const shutdown = () => {
      sdk.shutdown().catch(() => undefined);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (err: any) {
    console.error("[Observability] OpenTelemetry init failed:", err?.message ?? err);
  }
}
