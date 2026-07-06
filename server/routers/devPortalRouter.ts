/**
 * Developer Portal tRPC router — SYNAPSE R3 (doc 33 P6). READ-ONLY.
 *
 * Serves the portal index, the published specs, the extension points, a plugin-scaffold generator,
 * and a sandbox manifest check. No mutations — plugins are published to the registry, not via API.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { buildSeedSpecs } from "../services/contracts/apiSpec";
import { buildPortalIndex, sandboxCheck, newPluginManifest, conformanceChecklist } from "../services/devportal/devPortal";
import { EXTENSION_POINTS } from "../services/devportal/pluginTemplate";

const KINDS = ["device-connector", "robot-adapter", "skill", "enterprise-connector", "ai-model", "ui-widget"] as const;

export const devPortalRouter = router({
  /** Portal landing payload (specs summary, extension points, authoring steps, KPI). */
  index: protectedProcedure.query(() => buildPortalIndex()),

  /** Published OpenAPI 3.1 (REST). */
  openapi: protectedProcedure.query(() => buildSeedSpecs().openapi),
  /** Published AsyncAPI 2.6 (UNS). */
  asyncapi: protectedProcedure.query(() => buildSeedSpecs().asyncapi),

  /** The six extension points + their contracts. */
  extensionPoints: protectedProcedure.query(() => EXTENSION_POINTS),

  /** `synapse plugin new`: generate a manifest scaffold + conformance checklist for a kind. */
  newPlugin: protectedProcedure
    .input(z.object({ id: z.string().min(1).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/), kind: z.enum(KINDS) }))
    .query(({ input }) => ({
      manifest: newPluginManifest(input.id, input.kind),
      conformance: conformanceChecklist(input.kind),
    })),

  /** Sandbox check: validate a submitted manifest (+ apiVersion gate) before certification. */
  sandbox: protectedProcedure
    .input(z.object({ manifest: z.record(z.string(), z.unknown()) }))
    .query(({ input }) => sandboxCheck(input.manifest as never)),
});
