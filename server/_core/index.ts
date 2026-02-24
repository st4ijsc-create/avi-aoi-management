import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import fs from "fs";
import net from "net";
import path from "path";
import { eq } from "drizzle-orm";
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
import { initBulletinScheduler, stopBulletinScheduler } from "../services/mqttBulletinService";
import { cacheWarmingService } from "../services/cacheWarmingService";
import { initializeLicenseSystem, licenseEnforcementMiddleware } from "../license/license-middleware";
import { initializeRuntimeSecurity, shutdownRuntimeSecurity } from "../license/runtime-security";

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
  
  // ============================================================
  // CORS Configuration for External Machine Clients (AOI/AVI)
  // Allows cross-origin requests from C# applications on LAN
  // ============================================================
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Allow all origins (for LAN devices)
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", 
      "Content-Type, Authorization, x-api-key, x-machine-code, X-API-Key, X-Machine-Code, User-Agent, Content-Length, Accept, Origin");
    res.setHeader("Access-Control-Expose-Headers", 
      "Content-Length, Content-Type, ETag, X-Request-Id");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

    // Handle preflight OPTIONS requests
    if (req.method === "OPTIONS") {
      console.log(`[CORS] Preflight request: ${req.path}`);
      return res.status(204).end();
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

  // POST /api/machine/sync-points — Machine client pushes (PUT) measurement point definitions to server
  app.post("/api/machine/sync-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };

      const result = await caller.machineApi.syncMeasurementPoints(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] sync-points error:", error);
      res.status(400).json({ success: false, message: error?.message || "Sync points failed" });
    }
  });

  // GET /api/machine/get-points — Machine client pulls (GET) measurement point definitions from server
  app.get("/api/machine/get-points", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);

      const apiKey = req.header("x-api-key") || (req.query.apiKey as string);
      const machineCode = req.query.machineCode as string | undefined;
      const productModelCode = req.query.productModelCode as string | undefined;

      const input = { apiKey, machineCode, productModelCode };

      const result = await caller.machineApi.getPoints(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] get-points error:", error);
      res.status(400).json({ success: false, message: error?.message || "Get points failed" });
    }
  });

  // ============================================================
  // REST proxy: Machine self-registration (public, no API key)
  // ============================================================
  app.post("/api/machine/register", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const result = await caller.machine.register(req.body as any);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[MachineAPI] register error:", error);
      const status = error?.code === 'BAD_REQUEST' ? 400 : error?.code === 'NOT_FOUND' ? 404 : 500;
      res.status(status).json({ success: false, message: error?.message || "Registration failed" });
    }
  });

  // REST proxy: Machine config polling (public, no API key)
  app.get("/api/machine/config", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const serialNumber = req.query.serialNumber as string;
      if (!serialNumber) {
        return res.status(400).json({ success: false, message: "serialNumber query parameter is required" });
      }
      const result = await caller.machine.config({ serialNumber } as any);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[MachineAPI] config error:", error);
      const status = error?.code === 'NOT_FOUND' ? 404 : 500;
      res.status(status).json({ success: false, message: error?.message || "Config fetch failed" });
    }
  });

  // REST proxy: Machine heartbeat
  app.post("/api/machine/heartbeat", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: "API key is required (header X-API-Key or body.apiKey)" });
      }
      const result = await caller.machineApi.heartbeat({ apiKey } as any);
      res.json(result);
    } catch (error: any) {
      console.error("[MachineAPI] heartbeat error:", error);
      res.status(400).json({ success: false, message: error?.message || "Heartbeat failed" });
    }
  });

  // ============================================================
  // External Machine Registration API
  // Allows AVI/AOI clients to auto-register machines and get API keys
  // Uses Master API Key for authentication
  // ============================================================
  const MASTER_API_KEY = process.env.MASTER_API_KEY || "master_api_key_change_me";
  
  // Middleware to validate Master API Key
  const validateMasterKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const providedKey = req.header("x-master-key") || req.header("X-Master-Key") || req.query.masterKey;
    if (providedKey !== MASTER_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid or missing Master API Key" });
    }
    next();
  };

  // POST /api/external/machines/register - Register a new machine or return existing
  app.post("/api/external/machines/register", validateMasterKey, async (req, res) => {
    try {
      const { code, name, machineType, stationId, model, manufacturer, description } = req.body;

      if (!code || !name) {
        return res.status(400).json({ success: false, message: "code and name are required" });
      }

      // Validate machineType
      const validTypes = ["AVI", "AOI", "AUTOMATION"];
      const type = machineType || "AVI";
      if (!validTypes.includes(type)) {
        return res.status(400).json({ success: false, message: `machineType must be one of: ${validTypes.join(", ")}` });
      }

      const { getMachineByCode, createMachine, getDefaultStation } = await import("../db");
      const { nanoid } = await import("nanoid");

      // Check if machine already exists
      let machine = await getMachineByCode(code);

      if (machine) {
        // Machine exists, return its info
        console.log(`[External] Machine ${code} already exists, returning existing API key`);
        return res.json({
          success: true,
          created: false,
          machine: {
            id: machine.id,
            code: machine.code,
            name: machine.name,
            machineType: machine.machineType,
            apiKey: machine.apiKey,
            stationId: machine.stationId,
          },
          message: "Machine already exists",
        });
      }

      // Create new machine
      // If stationId not provided, use default station (id: 1) or first available
      let targetStationId = stationId;
      if (!targetStationId) {
        const defaultStation = await getDefaultStation();
        if (!defaultStation) {
          return res.status(400).json({ success: false, message: "No station available. Please create a station first or provide stationId." });
        }
        targetStationId = defaultStation.id;
      }

      const apiKey = `mach_${nanoid(32)}`;
      const machineId = await createMachine({
        stationId: targetStationId,
        code,
        name,
        machineType: type,
        model: model || null,
        manufacturer: manufacturer || null,
        description: description || null,
        apiKey,
      });

      console.log(`[External] New machine registered: ${code} (ID: ${machineId})`);

      res.json({
        success: true,
        created: true,
        machine: {
          id: machineId,
          code,
          name,
          machineType: type,
          apiKey,
          stationId: targetStationId,
        },
        message: "Machine registered successfully",
      });
    } catch (error: any) {
      console.error("[External] register-machine error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to register machine" });
    }
  });

  // GET /api/external/machines/by-code/:code - Get machine info by code
  app.get("/api/external/machines/by-code/:code", validateMasterKey, async (req, res) => {
    try {
      const { code } = req.params;

      if (!code) {
        return res.status(400).json({ success: false, message: "Machine code is required" });
      }

      const { getMachineByCode } = await import("../db");
      const machine = await getMachineByCode(code);

      if (!machine) {
        return res.status(404).json({ success: false, message: "Machine not found" });
      }

      res.json({
        success: true,
        machine: {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          machineType: machine.machineType,
          apiKey: machine.apiKey,
          stationId: machine.stationId,
          model: machine.model,
          manufacturer: machine.manufacturer,
          isActive: machine.isActive,
        },
      });
    } catch (error: any) {
      console.error("[External] get-machine error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get machine" });
    }
  });

  // GET /api/external/machines - List all machines
  app.get("/api/external/machines", validateMasterKey, async (req, res) => {
    try {
      const { getMachines } = await import("../db");
      const machines = await getMachines();

      res.json({
        success: true,
        total: machines.length,
        machines: machines.map(m => ({
          id: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          apiKey: m.apiKey,
          stationId: m.stationId,
          isActive: m.isActive,
        })),
      });
    } catch (error: any) {
      console.error("[External] list-machines error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to list machines" });
    }
  });

  // ============================================================
  // AOI Package - REST proxy for presign (create upload URL)
  // ============================================================
  app.post("/api/aoi/presign", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };
      const result = await caller.aoiPackage.presign(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[AOI] presign error:", error);
      res.status(400).json({ success: false, message: error?.message || "Presign failed" });
    }
  });

  // ============================================================
  // AOI Package - REST proxy for commit (confirm upload)
  // ============================================================
  app.post("/api/aoi/commit", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      const caller = appRouter.createCaller(ctx);
      const apiKey = req.header("x-api-key") || req.body.apiKey;
      const input = { ...req.body, apiKey };
      const result = await caller.aoiPackage.commit(input as any);
      res.json(result);
    } catch (error: any) {
      console.error("[AOI] commit error:", error);
      res.status(400).json({ success: false, message: error?.message || "Commit failed" });
    }
  });

  // ============================================================
  // AOI Package Upload - REST endpoint for binary ZIP upload
  // Agent uploads ZIP directly via this endpoint
  // ============================================================
  app.put("/api/aoi/upload/:packageId", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
    const startTime = Date.now();
    
    // Ensure CORS headers are set (even on error responses)
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    
    try {
      const { packageId } = req.params;
      const apiKey = req.header("x-api-key") || req.header("X-API-Key") || "";
      const machineCode = req.header("x-machine-code") || req.header("X-Machine-Code") || "";
      const contentType = req.header("content-type") || "";
      const contentLength = req.header("content-length") || "0";

      console.log(`[AOI-Upload] ${req.method} ${req.path} from ${req.ip || req.socket.remoteAddress}`);
      console.log(`[AOI-Upload] Origin: ${origin || 'none'}, Content-Type: ${contentType}, Content-Length: ${contentLength}`);
      console.log(`[AOI-Upload] Headers: API-Key=${apiKey ? 'present' : 'missing'}, Machine-Code=${machineCode || 'missing'}`);

      if (!apiKey && !machineCode) {
        console.warn(`[AOI-Upload] Missing credentials for ${packageId}`);
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

      // Detect retry (already uploaded before)
      const isRetry = pkg.status === "uploaded" || pkg.status === "uploading";

      const zipBuffer = req.body as Buffer;
      if (!zipBuffer || zipBuffer.length === 0) {
        console.error(`[AOI-Upload] Empty body for ${packageId}. Raw body type: ${typeof req.body}, Content-Type: ${contentType}`);
        return res.status(400).json({ success: false, message: "Empty request body. Ensure Content-Type is set correctly (application/zip or application/octet-stream)" });
      }

      console.log(`[AOI-Upload] Body received: ${zipBuffer.length} bytes for ${packageId}`);

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

      // Log activity: upload_success (or retry)
      try {
        const { packageActivityLogs } = await import("../../drizzle/schema");
        await database.insert(packageActivityLogs).values({
          packageDbId: pkg.id,
          packageId: packageId,
          machineId: machine.id,
          event: isRetry ? "retry" : "upload_success",
          level: "info",
          message: isRetry
            ? `ZIP re-uploaded (retry): ${(zipBuffer.length / 1024).toFixed(1)} KB`
            : `ZIP uploaded successfully: ${(zipBuffer.length / 1024).toFixed(1)} KB`,
          source: "agent",
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.header("user-agent") || null,
          fileSizeBytes: zipBuffer.length,
          detail: `Storage key: ${storageKey}`,
          metadata: { storageKey, sizeBytes: zipBuffer.length, isRetry },
        });
      } catch (_logErr) { /* logging should not break upload */ }

      res.json({ success: true, packageId, sizeBytes: zipBuffer.length, storageKey });
    } catch (error: any) {
      console.error("[AOI] upload error:", error);
      console.error("[AOI] Error stack:", error?.stack);
      console.error("[AOI] Request details:", {
        packageId: req.params.packageId,
        headers: req.headers,
        bodyType: typeof req.body,
        bodyLength: req.body?.length || 0,
      });

      // Log activity: upload_fail
      try {
        const { packageActivityLogs } = await import("../../drizzle/schema");
        const database2 = await getDb();
        const { packageId: pkgIdParam } = req.params;
        if (database2 && pkgIdParam) {
          const { inspectionPackages: ip } = await import("../../drizzle/schema");
          const found = await database2.select({ id: ip.id }).from(ip).where(eq(ip.packageId, pkgIdParam)).limit(1);
          if (found.length > 0) {
            await database2.insert(packageActivityLogs).values({
              packageDbId: found[0].id,
              packageId: pkgIdParam,
              event: "upload_fail",
              level: "error",
              message: `Upload failed: ${error?.message || 'Unknown error'}`,
              source: "server",
              detail: error?.stack || error?.message,
              ipAddress: req.ip || req.socket.remoteAddress || null,
              userAgent: req.header("user-agent") || null,
            });
          }
        }
      } catch (_logErr) { /* ignore */ }

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

        // Log activity: zip_download
        try {
          const { packageActivityLogs } = await import("../../drizzle/schema");
          await database.insert(packageActivityLogs).values({
            packageDbId: pkg.id,
            packageId: packageId,
            event: "zip_download",
            level: "info",
            message: `ZIP downloaded for audit`,
            source: "user",
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.header("user-agent") || null,
            fileSizeBytes: pkg.fileSizeBytes,
          });
        } catch (_logErr) { /* ignore */ }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${packageId}.zip"`);
        return res.sendFile(filePath);
      } else {
        // Log activity: zip_download
        try {
          const { packageActivityLogs } = await import("../../drizzle/schema");
          await database.insert(packageActivityLogs).values({
            packageDbId: pkg.id,
            packageId: packageId,
            event: "zip_download",
            level: "info",
            message: `ZIP downloaded for audit (redirect)`,
            source: "user",
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.header("user-agent") || null,
          });
        } catch (_logErr) { /* ignore */ }

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
  // License enforcement middleware (must be before tRPC mount)
  app.use("/api/trpc", licenseEnforcementMiddleware());
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Initialize License System (RSA keys)
  await initializeLicenseSystem();

  // Initialize Runtime Security (file integrity monitoring)
  initializeRuntimeSecurity();

  // Initialize Socket.io for realtime notifications
  initializeSocket(server);
  
  // Start offline machine monitor
  startOfflineMonitor();
  
  // Initialize email transporter
  initializeEmailTransporter();
  
  // Initialize scheduled reports (non-blocking with retry)
  initializeScheduledReports().catch((err) => {
    console.error("[ReportScheduler] Initialization failed, server continues without scheduled reports:", err?.message || err);
  });
  
  // Initialize MQTT broker (if enabled)
  if (process.env.MQTT_ENABLED === 'true') {
    initMqttBroker();
    initSummaryScheduler();
    startAlertEvaluationJob(1); // Run every 1 minute
    await initBulletinScheduler(); // Initialize periodic bulletin scheduler
    console.log('[MQTT] MQTT broker, alert evaluation, and bulletin scheduler enabled');
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
    shutdownRuntimeSecurity();
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
