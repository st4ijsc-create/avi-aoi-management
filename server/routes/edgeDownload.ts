/**
 * WS-2 — Edge model package download proxy (IEC 62443).
 *
 *   GET /api/edge/download/:deploymentId
 *
 * Security model:
 *   - The machine authenticates with its apiKey (header `x-api-key` or
 *     `Authorization: Bearer <apiKey>`, query `?apiKey=` allowed as fallback).
 *   - The apiKey is resolved to a machine row; the requested deployment must
 *     belong to that machine (matched by edge_deployments.machineId, or by
 *     deviceId === machine.code as a fallback for device-keyed deployments).
 *   - Machines NEVER receive a raw storage URL and CANNOT hit /uploads for a
 *     package directly — this proxy is the only path. A machine therefore can
 *     never download another machine's model (returns 403).
 *   - Supports HTTP Range (resume) so large packages survive flaky links.
 *
 * Storage duality: local-disk mode streams from LOCAL_STORAGE_DIR; Forge mode
 * fetches the upstream object and pipes it (Range forwarded when supported).
 */
import type express from "express";
import fs from "fs";
import path from "path";

export function registerEdgeDownloadRoute(app: express.Express) {
  app.get("/api/edge/download/:deploymentId", async (req, res) => {
    try {
      const deploymentId = parseInt(String(req.params.deploymentId), 10);
      if (!Number.isFinite(deploymentId)) {
        return res.status(400).json({ error: "Invalid deploymentId" });
      }

      // ── Resolve apiKey from header / bearer / query ──
      const headerKey =
        (req.headers["x-api-key"] as string | undefined) ??
        (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
          ? req.headers.authorization.slice("Bearer ".length).trim()
          : undefined) ??
        (typeof req.query.apiKey === "string" ? req.query.apiKey : undefined);

      if (!headerKey) {
        return res.status(401).json({ error: "Missing machine apiKey" });
      }

      const { getMachineByApiKey } = await import("../db");
      const { getEdgeDeployment, updateEdgeDeployment } = await import("../db/aiAdvanced");

      const machine = await getMachineByApiKey(headerKey);
      if (!machine) {
        return res.status(401).json({ error: "Invalid apiKey" });
      }

      const deployment = await getEdgeDeployment(deploymentId);
      if (!deployment) {
        return res.status(404).json({ error: "Deployment not found" });
      }

      // ── Ownership check — deployment must belong to this machine ──
      const ownsById = deployment.machineId != null && deployment.machineId === machine.id;
      const ownsByDevice = !!deployment.deviceId && deployment.deviceId === machine.code;
      if (!ownsById && !ownsByDevice) {
        return res.status(403).json({ error: "Deployment does not belong to this machine" });
      }

      if (!deployment.packageKey) {
        return res.status(409).json({ error: "Package not ready for this deployment" });
      }

      // Audit: machine has started pulling — flip READY → DOWNLOADING.
      if (deployment.status === "READY") {
        await updateEdgeDeployment(deploymentId, { status: "DOWNLOADING" }).catch(() => {});
      }

      const { storageGet } = await import("../storage");
      const { url } = await storageGet(deployment.packageKey);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="model-${deployment.modelId}-${deployment.packageVersion ?? "pkg"}.pkg"`,
      );
      if (deployment.packageHash) {
        res.setHeader("X-Package-Sha256", deployment.packageHash);
      }
      res.setHeader("Accept-Ranges", "bytes");

      const rangeHeader = req.headers.range;

      // ── Local-disk storage: stream file from disk with Range support ──
      if (url.startsWith("/uploads/")) {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadsRoot, url.replace("/uploads/", ""));

        // Defense-in-depth path-traversal guard.
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep)) {
          return res.status(400).json({ error: "Invalid package path" });
        }
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({ error: "Package file missing" });
        }

        const stat = fs.statSync(resolved);
        const total = stat.size;

        if (rangeHeader) {
          const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (m) {
            const start = m[1] ? parseInt(m[1], 10) : 0;
            const end = m[2] ? parseInt(m[2], 10) : total - 1;
            if (start > end || start >= total) {
              res.setHeader("Content-Range", `bytes */${total}`);
              return res.status(416).end();
            }
            res.status(206);
            res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
            res.setHeader("Content-Length", end - start + 1);
            return fs.createReadStream(resolved, { start, end }).pipe(res);
          }
        }

        res.setHeader("Content-Length", total);
        return fs.createReadStream(resolved).pipe(res);
      }

      // ── Forge proxy storage: fetch upstream object, forward Range ──
      const upstream = await fetch(url, {
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
      });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ error: "Upstream storage fetch failed" });
      }
      res.status(upstream.status === 206 ? 206 : 200);
      const cr = upstream.headers.get("content-range");
      if (cr) res.setHeader("Content-Range", cr);
      const cl = upstream.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);

      const arrayBuf = await upstream.arrayBuffer();
      return res.end(Buffer.from(arrayBuf));
    } catch (error: any) {
      console.error("[EdgeDownload] error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });

  console.log("[EdgeDownload] proxy route enabled at GET /api/edge/download/:deploymentId");
}
