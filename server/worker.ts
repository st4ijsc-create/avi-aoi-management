/**
 * W4-D (doc 27 §8 gap B7) — dedicated background-worker entry point.
 *
 * Runs ONLY the cron-like schedulers (reports, backups, retention, integrity
 * scan, AI cron jobs, ERP outbox drain, …) — no express app, no HTTP bind,
 * no Socket.IO, no MQTT broker. Pair it with the API entry started with
 * ROLE=api, which skips these schedulers:
 *
 *   API process:    ROLE=api npm run start        (HTTP + socket + MQTT + ingest)
 *   Worker process: npm run start:worker          (schedulers only)
 *   Dev worker:     npm run dev:worker
 *
 * Default topology is UNCHANGED: with ROLE unset, the main entry still runs
 * everything in one process and this file is simply never used.
 *
 * SINGLE-WORKER ASSUMPTION: run exactly ONE worker instance — the schedulers
 * have no leader election (documented out of scope, doc 27 Đợt 4.4).
 */
import "dotenv/config";
import { installConsoleBridge } from "./logger";
import { runWorkerProcess } from "./_core/backgroundJobs";

// Structured logging parity with the main entry (no-op unless LOG_JSON=1).
installConsoleBridge();

runWorkerProcess().catch((err) => {
  console.error("[Worker] Fatal startup error:", err);
  process.exit(1);
});
