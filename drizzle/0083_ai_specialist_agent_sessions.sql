-- Migration: 0083_ai_specialist_agent_sessions
-- Specialist agent workflow sessions and step-level history tracking

CREATE TABLE IF NOT EXISTS "ai_specialist_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "sessionType" varchar(30) DEFAULT 'single' NOT NULL,
  "moduleName" varchar(255),
  "objective" text NOT NULL,
  "requestedAgents" json,
  "language" varchar(10) DEFAULT 'vi' NOT NULL,
  "status" varchar(30) DEFAULT 'running' NOT NULL,
  "summary" text,
  "aggregateOutput" json,
  "startedAt" timestamp DEFAULT now() NOT NULL,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_specialist_sessions_user" ON "ai_specialist_sessions" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_sessions_module" ON "ai_specialist_sessions" USING btree ("moduleName");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_sessions_status" ON "ai_specialist_sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_sessions_created" ON "ai_specialist_sessions" USING btree ("createdAt");

CREATE TABLE IF NOT EXISTS "ai_specialist_session_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "sessionId" integer NOT NULL,
  "stepOrder" integer NOT NULL,
  "agentId" varchar(60) NOT NULL,
  "status" varchar(30) DEFAULT 'completed' NOT NULL,
  "inputPayload" json,
  "outputPayload" json,
  "modelId" varchar(255),
  "tokensPrompt" integer,
  "tokensGenerated" integer,
  "totalTimeMs" integer,
  "tokensPerSecond" numeric(10,2),
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_specialist_steps_session" ON "ai_specialist_session_steps" USING btree ("sessionId");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_steps_agent" ON "ai_specialist_session_steps" USING btree ("agentId");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_steps_status" ON "ai_specialist_session_steps" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_steps_created" ON "ai_specialist_session_steps" USING btree ("createdAt");
