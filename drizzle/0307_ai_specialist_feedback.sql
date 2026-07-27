-- Wave 1 — chấm tay chất lượng đầu ra của specialist agent.
-- Idempotent (IF NOT EXISTS) theo đúng khuôn migration 0298-0306.
CREATE TABLE IF NOT EXISTS "ai_specialist_feedback" (
  "id" serial PRIMARY KEY,
  "sessionId" integer NOT NULL,
  "userId" integer NOT NULL,
  "agentId" varchar(64) NOT NULL,
  "moduleName" varchar(255),
  "rating" varchar(16) NOT NULL,
  "usefulSections" json,
  "reason" text,
  "repoContextUsed" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_specialist_feedback_session_user"
  ON "ai_specialist_feedback" ("sessionId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_feedback_agent"
  ON "ai_specialist_feedback" ("agentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_feedback_module"
  ON "ai_specialist_feedback" ("moduleName");
