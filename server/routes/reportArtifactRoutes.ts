/**
 * Report artifact re-download route (doc 32 Wave R2 · decision #4/#5).
 * ============================================================================
 *   GET /api/reports/artifacts/:id/download
 *
 * The auth-gated web/mobile link for a persisted report artifact (decision #5 —
 * mobile opens this web link rather than downloading a server-rendered file
 * itself). Streams the stored bytes with the right content-type + filename.
 *
 * AUTH — a signed-in browser session (cookie) OR a scoped API key
 * (Authorization: Bearer / X-API-Key with `export:read`). Same authenticator as
 * /api/export. No credential → 401; key without scope → 403.
 *
 * ACCESS — the artifact must be readable by the caller: its creator, or a
 * privileged role (admin/supervisor/quality_inspector); API-key principals are
 * treated as privileged server-to-server readers. Otherwise 403.
 *
 * EXPIRY — an artifact past its retention deadline returns 410 GONE (the
 * cleanup job removes the object + row daily; this covers the window between
 * expiry and the next sweep).
 */
import type express from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { authenticateExportRequest } from "../api/export/exportRouter";
import {
  ArtifactError,
  getDownloadTarget,
  type ArtifactViewer,
} from "../services/reportArtifactService";

export function registerReportArtifactRoutes(app: express.Express): void {
  app.get("/api/reports/artifacts/:id/download", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, message: "Invalid artifact id" });
      }

      // Auth: session cookie or scoped API key (export:read).
      const auth = await authenticateExportRequest(req, "export:read");
      if (!auth.principal) {
        return res.status(auth.status).json({ success: false, message: auth.message });
      }
      const viewer: ArtifactViewer =
        auth.principal.kind === "session"
          ? { id: auth.principal.userId, role: auth.principal.userRole }
          : { privileged: true }; // trusted server-to-server key

      let target;
      try {
        target = await getDownloadTarget(id, viewer);
      } catch (err) {
        if (err instanceof ArtifactError) {
          const status = err.reason === "forbidden" ? 403 : err.reason === "expired" ? 410 : 404;
          return res.status(status).json({ success: false, reason: err.reason, message: err.message });
        }
        throw err;
      }

      const { artifact, directUrl, filename } = target;
      res.setHeader("Content-Type", artifact.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Artifact-Sha256", artifact.fileHash);
      res.setHeader("Cache-Control", "private, no-store");

      // Local-disk storage: stream the file from the uploads root (path-guarded).
      if (directUrl.startsWith("/uploads/")) {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadsRoot, directUrl.replace("/uploads/", ""));
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep)) {
          return res.status(400).json({ success: false, message: "Invalid artifact path" });
        }
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({ success: false, message: "Artifact file missing from storage" });
        }
        res.setHeader("Content-Length", fs.statSync(resolved).size);
        return fs.createReadStream(resolved).pipe(res);
      }

      // Forge / remote storage: fetch the upstream object and pipe it through.
      const upstream = await fetch(directUrl);
      if (!upstream.ok) {
        return res.status(502).json({ success: false, message: "Upstream storage fetch failed" });
      }
      const cl = upstream.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);
      if (!upstream.body) return res.end();
      return Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (error: any) {
      console.error("[ReportArtifact] download error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Internal server error" });
      } else {
        res.end();
      }
    }
  });

  console.log("[ReportArtifact] re-download route enabled at GET /api/reports/artifacts/:id/download");
}
