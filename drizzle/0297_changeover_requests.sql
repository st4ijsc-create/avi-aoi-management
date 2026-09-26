-- ============================================================================
-- Migration 0297: changeover_requests — duyệt 2-NGƯỜI cho đổi model (doc 63 DEP-08).
--
-- P3 FLW-03 critic: operator (quyền thấp) KHÔNG có đường khởi tạo yêu cầu đổi
-- model — aiCopilot.confirmAction buộc action gắn đúng NGƯỜI ĐỀ XUẤT (supervisor
-- không confirm được), và changeover-apply không phải registered AI write-tool.
-- Bảng này là hàng đợi mỏng: operator TẠO yêu cầu (trơ — không actuation);
-- supervisor/engineer DUYỆT (actuation role-floor + 2FA + SoD approver≠requester)
-- → gọi ĐÚNG đường deployRecipe sẵn có (ledger-only, từ chối recipe chưa được
-- second-approve W2-9). Bản ghi tự nó là audit (ai/lúc nào/quyết định gì).
--
-- status: pending | approved | rejected | cancelled (varchar, KHÔNG pg enum mới
-- — giữ migration additive, cùng convention master_alarms).
--
-- ADDITIVE + IDEMPOTENT. ROLLBACK: DROP TABLE "changeover_requests";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "changeover_requests" (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL REFERENCES "machines"("id") ON DELETE RESTRICT,
  "recipeId" integer NOT NULL REFERENCES "machine_recipes"("id") ON DELETE RESTRICT,
  "requestedBy" integer NOT NULL,
  "requestNote" text,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "decidedBy" integer,
  "decisionNote" text,
  "decidedAt" timestamp,
  "deploymentId" integer REFERENCES "recipe_deployments"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_changeover_requests_status" ON "changeover_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_changeover_requests_machine" ON "changeover_requests" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_changeover_requests_requester" ON "changeover_requests" ("requestedBy");
