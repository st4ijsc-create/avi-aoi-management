-- doc 33 I4 (F5 §5.11.2) — hash-chain WORM audit for control_audit_log.
-- Additive + idempotent + NULLABLE: legacy rows keep null; new rows (when SEC_PLATFORM on)
-- carry prevHash/hash linking to the previous row → any edit/insert/delete is tamper-evident.
-- Numbered 0220 to avoid colliding with doc-32's 0202 in the concurrent branch.
ALTER TABLE "control_audit_log" ADD COLUMN IF NOT EXISTS "prevHash" text;
ALTER TABLE "control_audit_log" ADD COLUMN IF NOT EXISTS "hash" text;
ALTER TABLE "control_audit_log" ADD COLUMN IF NOT EXISTS "hashTs" bigint;
