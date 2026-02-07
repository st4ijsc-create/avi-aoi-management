import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import fs from "fs";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { getDb } from "../db";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initializeSocket } from "./socket";
import { startOfflineMonitor } from "./offlineMonitor";
import { initializeEmailTransporter } from "./email";
import { initializeScheduledReports, shutdownScheduledReports } from "../services/reportScheduler";
import { initMqttBroker, shutdownMqttBroker } from "../services/mqttService";
import { startAlertEvaluationJob, stopAlertEvaluationJob } from "../services/alertEvaluationService";
import { initSummaryScheduler, stopSummaryScheduler } from "../services/mqttSummaryScheduler";
import { cacheWarmingService } from "../services/cacheWarmingService";

const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // Choose HTTP or HTTPS server based on configuration
  let server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

  if (HTTPS_ENABLED) {
    const keyPath = process.env.HTTPS_KEY_PATH;
    const certPath = process.env.HTTPS_CERT_PATH;
    const caPath = process.env.HTTPS_CA_PATH;

    if (!keyPath || !certPath) {
      throw new Error(
        "HTTPS_ENABLED=true nhưng HTTPS_KEY_PATH hoặc HTTPS_CERT_PATH chưa được cấu hình trong .env",
      );
    }

    const httpsOptions: any = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };

    if (caPath) {
      httpsOptions.ca = fs.readFileSync(caPath);
    }

    server = createHttpsServer(httpsOptions, app);
    console.log("[HTTPS] HTTPS server enabled");
  } else {
    server = createHttpServer(app);
  }
  
  // Enable CORS for external machine clients (e.g. inspection-submit-app.html)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Serve local uploads if STORAGE_MODE=local
  if (process.env.STORAGE_MODE === "local") {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");

    if (!fs.existsSync(uploadsRoot)) {
      fs.mkdirSync(uploadsRoot, { recursive: true });
    }

    app.use("/uploads", express.static(uploadsRoot));
    console.log(`[Storage] Local uploads enabled at /uploads (dir: ${uploadsRoot})`);
  }

  // REST endpoints for external machines (proxy to tRPC machineApi router)
  app.post("/api/machine/submit-inspection", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.submitInspection(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] submit-inspection error:", error);
      res.status(400).json({ success: false, message: error?.message || "Submit inspection failed" });
    }
  });

  app.post("/api/machine/upload-image", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.uploadImage(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] upload-image error:", error);
      res.status(400).json({ success: false, message: error?.message || "Upload image failed" });
    }
  });

  // ============================================================
  // AOI Package Upload - REST endpoint for binary ZIP upload
  // Agent uploads ZIP directly via this endpoint
  // ============================================================
  app.put("/api/aoi/upload/:packageId", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
    try {
      const { packageId } = req.params;
      const apiKey = req.header("x-api-key") || "";
      const machineCode = req.header("x-machine-code") || "";

      if (!apiKey && !machineCode) {
        return res.status(401).json({ success: false, message: "x-api-key or x-machine-code header required" });
      }

      // Validate machine
      const { getDb } = await import("../db");
      const { getMachineByApiKey, getMachineByCode } = await import("../db");
      let machine;
      if (apiKey) {
        machine = await getMachineByApiKey(apiKey);
      } else {
        machine = await getMachineByCode(machineCode);
      }
      if (!machine) {
        return res.status(401).json({ success: false, message: "Invalid machine credentials" });
      }

      // Find package record
      const database = await getDb();
      if (!database) {
        return res.status(500).json({ success: false, message: "Database unavailable" });
      }

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) {
        return res.status(404).json({ success: false, message: "Package not found. Call presign first." });
      }

      const pkg = pkgs[0];
      if (pkg.machineId !== machine.id) {
        return res.status(403).json({ success: false, message: "Package belongs to another machine" });
      }

      // Check if already uploaded
      if (pkg.status === "committed") {
        return res.json({ success: true, alreadyUploaded: true, packageId });
      }

      const zipBuffer = req.body as Buffer;
      if (!zipBuffer || zipBuffer.length === 0) {
        return res.status(400).json({ success: false, message: "Empty request body" });
      }

      // Store the ZIP file
      const { storagePut } = await import("../storage");
      const storageKey = pkg.storageKey || `aoi/${machine.code}/${new Date().toISOString().slice(0, 10).replace(/-/g, "/")}/${packageId}.zip`;

      await storagePut(storageKey, zipBuffer, "application/zip");

      // Update package status
      await database
        .update(inspectionPackages)
        .set({
          status: "uploaded" as const,
          storageKey,
          fileSizeBytes: zipBuffer.length,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(inspectionPackages.id, pkg.id));

      console.log(`[AOI] ZIP uploaded: ${packageId} (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB) from machine ${machine.code}`);
      res.json({ success: true, packageId, sizeBytes: zipBuffer.length, storageKey });
    } catch (error: any) {
      console.error("[AOI] upload error:", error);
      res.status(500).json({ success: false, message: error?.message || "Upload failed" });
    }
  });

  // AOI Package - Serve image directly (non-tRPC endpoint for <img> tags)
  app.get("/api/aoi/image/:packageId/:fileName", async (req, res) => {
    try {
      const { packageId, fileName } = req.params;

      const database = await getDb();
      if (!database) {
        return res.status(500).json({ success: false, message: "Database unavailable" });
      }

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) return res.status(404).json({ message: "Package not found" });
      const pkg = pkgs[0];

      // Extract & serve image (import the helper from router)
      const { storagePut: _, storageGet } = await import("../storage");
      const JSZip = (await import("jszip")).default;
      const fsMod = await import("fs");
      const pathMod = await import("path");

      const CACHE_DIR = process.env.AOI_CACHE_DIR
        ? pathMod.resolve(process.env.AOI_CACHE_DIR)
        : pathMod.join(process.cwd(), "uploads", "aoi-cache");
      const CACHE_TTL_DAYS = parseInt(process.env.AOI_CACHE_TTL_DAYS || "7");

      const cacheKey = `${packageId}/${fileName}`;
      const cachePath = pathMod.join(CACHE_DIR, cacheKey);

      // Check cache first
      if (fsMod.existsSync(cachePath)) {
        const stat = fsMod.statSync(cachePath);
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays < CACHE_TTL_DAYS) {
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader("X-Cache", "HIT");
          return res.send(fsMod.readFileSync(cachePath));
        }
      }

      if (!pkg.storageKey) return res.status(404).json({ message: "ZIP not available" });

      let zipBuffer: Buffer;
      const storageMode = process.env.STORAGE_MODE ?? "forge";
      if (storageMode === "local") {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? pathMod.resolve(process.env.LOCAL_STORAGE_DIR)
          : pathMod.join(process.cwd(), "uploads");
        const filePath = pathMod.join(uploadsRoot, pkg.storageKey);
        if (!fsMod.existsSync(filePath)) return res.status(404).json({ message: "ZIP file not found" });
        zipBuffer = fsMod.readFileSync(filePath);
      } else {
        const { url } = await storageGet(pkg.storageKey);
        const response = await fetch(url);
        if (!response.ok) return res.status(500).json({ message: "Failed to download ZIP" });
        zipBuffer = Buffer.from(await response.arrayBuffer());
      }

      const zip = await JSZip.loadAsync(zipBuffer);
      const imageFile = zip.file(`images/${fileName}`) || zip.file(fileName);
      if (!imageFile) return res.status(404).json({ message: `Image ${fileName} not found in ZIP` });

      const imageBuffer = Buffer.from(await imageFile.async("uint8array"));

      // Cache the extracted image
      const cacheDir = pathMod.dirname(cachePath);
      if (!fsMod.existsSync(cacheDir)) fsMod.mkdirSync(cacheDir, { recursive: true });
      fsMod.writeFileSync(cachePath, imageBuffer);

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Cache", "MISS");
      return res.send(imageBuffer);
    } catch (error: any) {
      console.error("[AOI] image serve error:", error);
      res.status(500).json({ message: error?.message || "Failed to serve image" });
    }
  });

  // AOI Package - Download original ZIP for audit
  app.get("/api/aoi/download/:packageId", async (req, res) => {
    try {
      const { packageId } = req.params;
      const database = await getDb();
      if (!database) return res.status(500).json({ message: "Database unavailable" });

      const { inspectionPackages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const pkgs = await database
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.packageId, packageId))
        .limit(1);

      if (pkgs.length === 0) return res.status(404).json({ message: "Package not found" });
      const pkg = pkgs[0];
      if (!pkg.storageKey) return res.status(404).json({ message: "ZIP not available" });

      const storageMode = process.env.STORAGE_MODE ?? "forge";
      if (storageMode === "local") {
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadsRoot, pkg.storageKey);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: "ZIP file not found" });
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${packageId}.zip"`);
        return res.sendFile(filePath);
      } else {
        const { storageGet } = await import("../storage");
        const { url } = await storageGet(pkg.storageKey);
        return res.redirect(url);
      }
    } catch (error: any) {
      console.error("[AOI] download error:", error);
      res.status(500).json({ message: error?.message || "Download failed" });
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Initialize Socket.io for realtime notifications
  initializeSocket(server);
  
  // Start offline machine monitor
  startOfflineMonitor();
  
  // Initialize email transporter
  initializeEmailTransporter();
  
  // Initialize scheduled reports
  await initializeScheduledReports();
  
  // Initialize MQTT broker (if enabled)
  if (process.env.MQTT_ENABLED === 'true') {
    initMqttBroker();
    initSummaryScheduler();
    startAlertEvaluationJob(1); // Run every 1 minute
    console.log('[MQTT] MQTT broker and alert evaluation enabled');
  } else {
    console.log('[MQTT] MQTT broker disabled (set MQTT_ENABLED=true to enable)');
  }

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const protocol = HTTPS_ENABLED ? "https" : "http";

  server.listen(port, () => {
    console.log(`Server running on ${protocol}://localhost:${port}/`);
    
    // Initialize cache warming service
    cacheWarmingService.initialize().catch(err => {
      console.error('[CacheWarming] Failed to initialize:', err.message);
    });
  });
  
  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    shutdownScheduledReports();
    cacheWarmingService.stop();
    if (process.env.MQTT_ENABLED === 'true') {
      shutdownMqttBroker();
      stopSummaryScheduler();
    }
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
  
  process.on("SIGINT", () => {
    console.log("SIGINT received, shutting down gracefully...");
    shutdownScheduledReports();
    cacheWarmingService.stop();
    if (process.env.MQTT_ENABLED === 'true') {
      shutdownMqttBroker();
      stopSummaryScheduler();
    }
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

startServer().catch(console.error);
