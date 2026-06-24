-- Phase 3 — Robotics framework: robot registry + state telemetry + motion job log.
-- Idempotent (auto-applied by the standalone runner).

DO $$ BEGIN
  CREATE TYPE robotvendorenum AS ENUM ('fanuc','mitsubishi','delta','techman','sim');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE robotkindenum AS ENUM ('arm','scara','cobot','agv');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE robotjobtypeenum AS ENUM ('move','pick_place','dispense','screw','home','abort','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE robotjobstatusenum AS ENUM ('draft','pending','confirmed','running','done','failed','simulated','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS robots (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "vendor" robotvendorenum NOT NULL,
  "model" varchar(128),
  "kind" robotkindenum DEFAULT 'arm' NOT NULL,
  "endpoint" varchar(255) NOT NULL,
  "connectionOptions" jsonb,
  "pollIntervalMs" integer DEFAULT 5000 NOT NULL,
  "isEnabled" boolean DEFAULT false NOT NULL,
  "status" varchar(32) DEFAULT 'offline' NOT NULL,
  "lineId" integer,
  "stationId" integer,
  "lastSeenAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_robots_vendor" ON robots ("vendor");
CREATE INDEX IF NOT EXISTS "idx_robots_enabled" ON robots ("isEnabled");

CREATE TABLE IF NOT EXISTS robot_telemetry (
  "id" serial PRIMARY KEY,
  "robotId" integer NOT NULL,
  "mode" varchar(32),
  "busy" boolean,
  "estop" boolean,
  "poseJson" jsonb,
  "payloadKg" numeric(8,3),
  "speedPct" integer,
  "errorText" text,
  "timestamp" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_robot_telemetry_robot_time" ON robot_telemetry ("robotId","timestamp");
CREATE INDEX IF NOT EXISTS "idx_robot_telemetry_timestamp" ON robot_telemetry ("timestamp");

CREATE TABLE IF NOT EXISTS robot_jobs (
  "id" serial PRIMARY KEY,
  "robotId" integer NOT NULL,
  "jobType" robotjobtypeenum NOT NULL,
  "params" jsonb,
  "status" robotjobstatusenum DEFAULT 'simulated' NOT NULL,
  "triggerKind" varchar(16) DEFAULT 'hitl' NOT NULL,
  "actionId" varchar(64),
  "requestedBy" integer,
  "confirmedBy" integer,
  "idempotencyKey" varchar(128) UNIQUE,
  "result" jsonb,
  "errorText" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "startedAt" timestamp,
  "completedAt" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_robot_jobs_robot" ON robot_jobs ("robotId");
CREATE INDEX IF NOT EXISTS "idx_robot_jobs_status" ON robot_jobs ("status");
CREATE INDEX IF NOT EXISTS "idx_robot_jobs_created" ON robot_jobs ("createdAt");
