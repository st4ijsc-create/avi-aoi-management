-- doc 33 §11 audit fix — enforce one seq per run event.
-- The D1 durable RunEvent log assigned seq via read-then-insert; under concurrent appends (parallel
-- DAG branches / fire-and-forget transitions) two rows could share a seq, corrupting replay order.
-- runEventStore now serialises with a per-run advisory lock; this UNIQUE index is the fail-loud
-- backstop. Additive + idempotent. FOE_DURABLE is default-off so the table is empty (no dup risk).
DROP INDEX IF EXISTS "idx_run_events_run";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_events_run" ON "orchestration_run_events" ("runId", "seq");
