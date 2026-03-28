-- Migration: 0077_ai_phase4_chat_edge_training
-- Phase 4: AI Chat conversations/messages, Edge AI Enhanced, Built-in Training

-- Chat role enum
DO $$ BEGIN
  CREATE TYPE "public"."chatroleenum" AS ENUM('system', 'user', 'assistant', 'tool');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AI Chat Conversations
CREATE TABLE IF NOT EXISTS "ai_chat_conversations" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "title" varchar(255),
  "context" json,
  "messageCount" integer DEFAULT 0 NOT NULL,
  "lastMessageAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_chat_conv_user" ON "ai_chat_conversations" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "idx_chat_conv_updated" ON "ai_chat_conversations" USING btree ("updatedAt");

-- AI Chat Messages
CREATE TABLE IF NOT EXISTS "ai_chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversationId" integer NOT NULL,
  "role" "chatroleenum" NOT NULL,
  "content" text,
  "toolCalls" json,
  "toolResults" json,
  "tokensUsed" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_chat_msg_conversation" ON "ai_chat_messages" USING btree ("conversationId");
CREATE INDEX IF NOT EXISTS "idx_chat_msg_role" ON "ai_chat_messages" USING btree ("role");
CREATE INDEX IF NOT EXISTS "idx_chat_msg_created" ON "ai_chat_messages" USING btree ("createdAt");
