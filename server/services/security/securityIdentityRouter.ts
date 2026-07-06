/**
 * Admin router — device X.509 PKI + service identity — doc 37 Đợt-C2 (năng lực 14).
 *
 * Minimal admin surface: issue/list/verify/rotate/revoke device certs, view service
 * identities, mint a service SVID, and read enforcement-flag status. All procedures are
 * adminProcedure (admin + 2FA). Issuance works regardless of the enforcement flags so an
 * operator can pre-provision before flipping DEVICE_PKI_ENABLED / SERVICE_MTLS_ENABLED on.
 *
 * WIRING (wave-lead): this router is NOT registered in server/routers.ts by this change.
 * To expose it, add to the appRouter map, e.g.:
 *     import { securityIdentityRouter } from "./services/security/securityIdentityRouter";
 *     // inside router({ ... }):
 *     securityIdentity: securityIdentityRouter,
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../../_core/trpc";
import {
  issueDeviceCert,
  verifyDeviceCert,
  rotateDeviceCert,
  revokeDeviceCert,
  listDeviceCerts,
  certsDueForRotation,
  devicePkiEnabled,
} from "./deviceIdentityService";
import {
  issueServiceIdentity,
  listServiceIdentities,
  revokeServiceIdentity,
  issueJwtSvid,
  serviceMtlsEnabled,
} from "./serviceIdentityService";
import { buildCaCert, getTrustDomain } from "./internalCa";

const deviceKind = z.enum(["adapter", "robot", "edge_node", "plc", "generic"]);

export const securityIdentityRouter = router({
  // ── enforcement flag + CA status ───────────────────────────────────────────
  status: adminProcedure.query(async () => {
    let ca: Awaited<ReturnType<typeof buildCaCert>> | null = null;
    try {
      ca = await buildCaCert();
    } catch {
      ca = null;
    }
    return {
      trustDomain: getTrustDomain(),
      devicePkiEnabled: devicePkiEnabled(),
      serviceMtlsEnabled: serviceMtlsEnabled(),
      ca: ca
        ? {
            subjectCn: ca.subjectCn,
            fingerprintSha256: ca.fingerprintSha256,
            pubkeyPem: ca.pubkeyPem,
            notAfter: ca.notAfter,
          }
        : null,
    };
  }),

  // ── device certificates ────────────────────────────────────────────────────
  issueDeviceCert: adminProcedure
    .input(
      z.object({
        deviceId: z.string().min(1).max(255),
        kind: deviceKind.optional(),
        days: z.number().int().min(1).max(825).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { record, privateKeyPem } = await issueDeviceCert(input.deviceId, {
          kind: input.kind,
          days: input.days,
        });
        // privateKeyPem is returned ONCE — the caller must persist it on the device.
        return { record, privateKeyPem };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
      }
    }),

  listDeviceCerts: adminProcedure
    .input(z.object({ deviceId: z.string().optional() }).optional())
    .query(async ({ input }) => listDeviceCerts(input?.deviceId)),

  verifyDeviceCert: adminProcedure
    .input(z.object({ pem: z.string().min(1) }))
    // Force enabled=true so an admin can validate a cert even while enforcement is OFF.
    .mutation(async ({ input }) => verifyDeviceCert(input.pem, { enabled: true })),

  rotateDeviceCert: adminProcedure
    .input(z.object({ deviceId: z.string().min(1).max(255), days: z.number().int().min(1).max(825).optional() }))
    .mutation(async ({ input }) => {
      try {
        return await rotateDeviceCert(input.deviceId, { days: input.days });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
      }
    }),

  revokeDeviceCert: adminProcedure
    .input(z.object({ certId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const rec = await revokeDeviceCert(input.certId, input.reason);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "certificate not found" });
      return rec;
    }),

  certsDueForRotation: adminProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input }) => certsDueForRotation(input?.withinDays)),

  // ── service identities (SPIFFE-lite) ───────────────────────────────────────
  issueServiceIdentity: adminProcedure
    .input(
      z.object({
        serviceName: z.string().min(1).max(128),
        withCert: z.boolean().optional(),
        days: z.number().int().min(1).max(825).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await issueServiceIdentity(input.serviceName, { withCert: input.withCert, days: input.days });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
      }
    }),

  listServiceIdentities: adminProcedure.query(async () => listServiceIdentities()),

  revokeServiceIdentity: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const rec = await revokeServiceIdentity(input.id);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "service identity not found" });
      return rec;
    }),

  issueServiceSvid: adminProcedure
    .input(
      z.object({
        serviceName: z.string().min(1).max(128),
        audience: z.string().max(255).optional(),
        ttlSeconds: z.number().int().min(60).max(86400).optional(),
      }),
    )
    .mutation(async ({ input }) =>
      issueJwtSvid(input.serviceName, { audience: input.audience, ttlSeconds: input.ttlSeconds }),
    ),
});
