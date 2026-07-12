/**
 * Report Artifact Router (doc 32 Wave R2 · §3 archive layer).
 * ============================================================================
 * tRPC surface over server/services/reportArtifactService — the persisted
 * report-artifact store (report_artifacts, migration 0202). Lets the web app
 * list a user's rendered reports, fetch metadata, resolve a re-download link,
 * and delete an artifact — all access-checked (creator or admin/quality) and
 * expiry-aware (expired → GONE).
 *
 * NOTE: tRPC has no HTTP-410 error code, so `download` maps an expired artifact
 * to NOT_FOUND with an explicit "expired" message; the REST route
 * (GET /api/reports/artifacts/:id/download) returns a true 410.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  ArtifactError,
  ARTIFACT_FORMATS,
  ARTIFACT_SOURCES,
  getArtifact,
  getDownloadTarget,
  listArtifacts,
  deleteArtifact,
  artifactDownloadPath,
  type ArtifactViewer,
} from "../services/reportArtifactService";

function viewerOf(ctx: { user: { id: number; role: string } }): ArtifactViewer {
  return { id: ctx.user.id, role: ctx.user.role };
}

function mapArtifactError(err: unknown): never {
  if (err instanceof ArtifactError) {
    const code = err.reason === "forbidden" ? "FORBIDDEN" : "NOT_FOUND";
    throw new TRPCError({ code, message: err.message });
  }
  throw err;
}

export const reportArtifactRouter = router({
  /** Paginated list of the caller's artifacts (privileged roles see all + may filter by createdBy). */
  list: protectedProcedure
    .input(
      z
        .object({
          createdBy: z.number().optional(),
          reportType: z.string().max(64).optional(),
          format: z.enum(ARTIFACT_FORMATS as [string, ...string[]]).optional(),
          source: z.enum(ARTIFACT_SOURCES as [string, ...string[]]).optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          includeExpired: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return listArtifacts(viewerOf(ctx as never), {
        ...(input ?? {}),
        format: input?.format as never,
        source: input?.source as never,
      });
    }),

  /** Access-checked metadata for one artifact. */
  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    try {
      return await getArtifact(input.id, viewerOf(ctx as never));
    } catch (err) {
      mapArtifactError(err);
    }
  }),

  /**
   * Resolve a re-download for one artifact. Returns the auth-gated REST link
   * (decision #5 — mobile opens this web link) plus a fresh (possibly signed)
   * direct storage URL. Access + expiry checked (expired → NOT_FOUND/"expired").
   */
  download: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    try {
      const t = await getDownloadTarget(input.id, viewerOf(ctx as never));
      return {
        id: t.artifact.id,
        downloadUrl: t.downloadUrl,
        directUrl: t.directUrl,
        filename: t.filename,
        format: t.artifact.format,
        contentType: t.artifact.contentType,
        fileSize: t.artifact.fileSize,
        expiresAt: t.artifact.expiresAt,
      };
    } catch (err) {
      mapArtifactError(err);
    }
  }),

  /** Access-checked delete (storage object + row). */
  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    try {
      const ok = await deleteArtifact(input.id, viewerOf(ctx as never));
      return { success: ok, downloadUrl: artifactDownloadPath(input.id) };
    } catch (err) {
      mapArtifactError(err);
    }
  }),

  /**
   * On-demand report generation for the web (doc 32 R4 items 15/16). Runs the
   * SAME pipeline the external/mobile path uses — externalReportService: R1
   * aggregators → renderReport (R2-A) → persistArtifact (R2-B) — but with
   * `source: "on_demand"` and the caller as creator, so every on-demand export
   * lands in the artifact history and is re-downloadable (fixes item 16: on-demand
   * exports previously had no history). Optionally emails the download link to
   * `emailTo` ("email me this report").
   */
  generate: protectedProcedure
    .input(
      z.object({
        reportType: z.string(),
        format: z.enum(["pdf", "xlsx", "csv", "html", "excel"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        locale: z.string().optional(),
        filters: z.record(z.string(), z.any()).optional(),
        /** Optional recipients — when present, emails the artifact link to them. */
        emailTo: z.array(z.string().email()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { generateExternalReport, ExternalReportError } = await import(
        "../services/externalReportService"
      );
      let result;
      try {
        result = await generateExternalReport({
          reportType: input.reportType,
          format: input.format,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          locale: input.locale,
          filters: input.filters as never,
          createdBy: ctx.user.id,
          source: "on_demand",
        });
      } catch (err) {
        if (err instanceof ExternalReportError) {
          throw new TRPCError({
            code: err.status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }

      let emailedTo = 0;
      if (input.emailTo && input.emailTo.length > 0) {
        try {
          const { sendEmail } = await import("../_core/email");
          // Absolute link when PUBLIC_APP_URL is configured; relative path otherwise
          // (still resolvable once the recipient is on the app + authenticated).
          const base = (process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
          const link = `${base}${result.downloadUrl}`;
          const expiry = result.expiresAt.toISOString().slice(0, 10);
          const html = `
            <div style="font-family:Arial,sans-serif;color:#334155;max-width:560px;">
              <h2 style="color:#0f172a;margin:0 0 6px;">${result.title}</h2>
              <p style="color:#64748b;margin:0 0 16px;">${input.dateFrom ?? ""} → ${input.dateTo ?? ""}</p>
              <p style="margin:0 0 12px;">Báo cáo (${result.format.toUpperCase()}, ${result.rowCount} dòng) đã sẵn sàng.</p>
              <p style="margin:0 0 16px;"><a href="${link}" style="background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Tải báo cáo</a></p>
              <p style="color:#94a3b8;font-size:12px;margin:0;">Liên kết cần đăng nhập · hết hạn ${expiry}</p>
            </div>`;
          await sendEmail({
            to: input.emailTo,
            subject: `[SYNAPSE] ${result.title}`,
            html,
          });
          emailedTo = input.emailTo.length;
        } catch (err) {
          // The report itself is generated + persisted; surface a soft email error.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Report generated (id ${result.reportId}) but email delivery failed: ${(err as any)?.message || err}`,
          });
        }
      }

      return {
        reportId: result.reportId,
        downloadUrl: result.downloadUrl,
        format: result.format,
        reportType: result.reportType,
        title: result.title,
        rowCount: result.rowCount,
        fileSize: result.fileSize,
        expiresAt: result.expiresAt,
        emptyState: result.emptyState,
        emptyReason: result.emptyReason,
        emailedTo,
      };
    }),
});
