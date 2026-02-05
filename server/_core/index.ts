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
