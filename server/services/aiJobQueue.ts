/**
 * AI Job Queue — S3.2
 *
 * In-memory async queue for long-running narrative / insight generation jobs.
 * Limits concurrent inference to avoid GGUF VRAM contention.
 *
 * Workflow:
 *   1. enqueue(...) → returns jobId immediately
 *   2. worker processes jobs serially (concurrency = 1 by default)
 *   3. getJob(jobId) returns current status / result
 *   4. completed/failed jobs auto-expire after JOB_TTL_MS
 */

import { randomUUID } from "crypto";
import {
  generateNarrative,
  generateInsightJson,
  type NarrativeRequest,
  type NarrativeResult,
  type InsightJsonRequest,
  type InsightJsonResult,
} from "./aiProviderRouter";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobKind = "narrative" | "insight";

export interface AiJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Job-specific request payload (do NOT expose if it contains secrets) */
  requestSummary: { promptLength: number; systemPromptLength: number; cacheKey?: string };
  /** Result on success */
  result?: NarrativeResult | InsightJsonResult<unknown>;
  /** Error message on failure */
  error?: string;
  /** Owner user id (for access control) */
  userId?: number | string;
}

interface QueuedJob extends AiJob {
  /** The actual executor closure */
  run: () => Promise<NarrativeResult | InsightJsonResult<unknown>>;
}

const JOB_TTL_MS = 30 * 60 * 1000; // 30 min retention after finish
const MAX_QUEUE_SIZE = 100;
const CONCURRENCY = Number(process.env.AI_JOB_CONCURRENCY || "1");

const jobs = new Map<string, QueuedJob>();
const pending: string[] = [];
let running = 0;

function emit(event: string, job: AiJob) {
  console.log(`[aiJobQueue] ${event} ${job.kind}#${job.id} status=${job.status}`);
}

function pump() {
  while (running < CONCURRENCY && pending.length > 0) {
    const id = pending.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    running++;
    job.status = "running";
    job.startedAt = Date.now();
    emit("start", job);
    job
      .run()
      .then(result => {
        job.status = "completed";
        job.finishedAt = Date.now();
        job.result = result;
        emit("done", job);
      })
      .catch((err: any) => {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = String(err?.message || err);
        emit("fail", job);
      })
      .finally(() => {
        running--;
        scheduleCleanup(job.id);
        pump();
      });
  }
}

function scheduleCleanup(id: string) {
  setTimeout(() => {
    jobs.delete(id);
  }, JOB_TTL_MS).unref?.();
}

function publicView(job: QueuedJob): AiJob {
  const { run, ...rest } = job;
  void run;
  return rest;
}

export function enqueueNarrative(req: NarrativeRequest, userId?: number | string): AiJob {
  if (jobs.size >= MAX_QUEUE_SIZE) {
    throw new Error(`AI job queue full (max ${MAX_QUEUE_SIZE})`);
  }
  const id = randomUUID();
  const job: QueuedJob = {
    id,
    kind: "narrative",
    status: "queued",
    createdAt: Date.now(),
    userId,
    requestSummary: {
      promptLength: req.prompt?.length || 0,
      systemPromptLength: req.systemPrompt?.length || 0,
      cacheKey: req.cacheKey,
    },
    run: () => generateNarrative(req),
  };
  jobs.set(id, job);
  pending.push(id);
  emit("enqueue", job);
  pump();
  return publicView(job);
}

export function enqueueInsight<T = unknown>(req: InsightJsonRequest<T>, userId?: number | string): AiJob {
  if (jobs.size >= MAX_QUEUE_SIZE) {
    throw new Error(`AI job queue full (max ${MAX_QUEUE_SIZE})`);
  }
  const id = randomUUID();
  const job: QueuedJob = {
    id,
    kind: "insight",
    status: "queued",
    createdAt: Date.now(),
    userId,
    requestSummary: {
      promptLength: req.prompt?.length || 0,
      systemPromptLength: req.systemPrompt?.length || 0,
      cacheKey: req.cacheKey,
    },
    run: () => generateInsightJson<T>(req) as Promise<InsightJsonResult<unknown>>,
  };
  jobs.set(id, job);
  pending.push(id);
  emit("enqueue", job);
  pump();
  return publicView(job);
}

export function getJob(id: string, userId?: number | string): AiJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  // Owner-only access if userId is provided on both sides
  if (userId !== undefined && job.userId !== undefined && job.userId !== userId) return null;
  return publicView(job);
}

export function listJobs(userId?: number | string, limit = 50): AiJob[] {
  const all: AiJob[] = [];
  for (const job of jobs.values()) {
    if (userId !== undefined && job.userId !== undefined && job.userId !== userId) continue;
    all.push(publicView(job));
  }
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export function getQueueSnapshot() {
  return {
    total: jobs.size,
    queued: pending.length,
    running,
    concurrency: CONCURRENCY,
    maxQueueSize: MAX_QUEUE_SIZE,
  };
}

export function cancelJob(id: string, userId?: number | string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (userId !== undefined && job.userId !== undefined && job.userId !== userId) return false;
  if (job.status === "queued") {
    const idx = pending.indexOf(id);
    if (idx >= 0) pending.splice(idx, 1);
    job.status = "failed";
    job.error = "cancelled";
    job.finishedAt = Date.now();
    scheduleCleanup(id);
    return true;
  }
  return false;
}
