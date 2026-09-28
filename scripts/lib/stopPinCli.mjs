/**
 * doc 81 Đợt 1D Task 1 fix round 2 — LUẬT GHIM DỪNG cho CLI `scripts/mappings-import.mjs` (importer thứ
 * ba của device_tags, SQL thô — không nạp được mã TS của server).
 *
 * Bản .mjs của đúng ba thứ ở server (giữ KHỚP — `scripts/lib/stopPinCli.unit.test.ts` so từng bộ vector
 * với chính bản TS):
 *   • `lyDoGoStopPinCli`  ≡ `lyDoGoStopPinKhiSuaTag` (server/services/ot/stopPin.ts) — trên hàng DB thô
 *     (cột camelCase + stop_value) và bản ghi file (datatype/enabled/scale/offset theo YAML);
 *   • `canonicalize`       ≡ server/services/security/auditChain.ts#canonicalize;
 *   • `computeAuditHash`   ≡ server/services/audit/controlAuditService.ts#computeAuditHash (hash-chain WORM khi
 *     SEC_PLATFORM bật — dòng KHÔNG hash sau khi chuỗi đã bắt đầu bị `verifyAuditRows` coi là giả mạo).
 *   • `goStopPinCliTx`     — gỡ ghim + MỘT dòng control_audit_log (cùng hình `ghiAuditGoStopPinTx`) + MỘT
 *     dòng audit_logs, bằng CHÍNH `tx` của lượt import (audit hỏng ⇒ cả import rollback).
 *     audit_logs KHÔNG mang contentHash: khoá HMAC nằm ở kho bí mật của app (getSecretSync) — CLI không
 *     có; lược đồ per-row của audit_logs chấp nhận dòng không hash (verifyCrudContentHash: legacy ⇒ ok).
 */
import crypto from "crypto";

export const GENESIS_HASH = "0".repeat(64);
const AUDIT_CHAIN_LOCK = 918_273_645; // = controlAuditService.AUDIT_CHAIN_LOCK
export const THAO_TAC_CLI = "mapping_import_cli";

export function canonicalize(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

export function computeAuditHash(prevHash, fields, ts) {
  return crypto.createHash("sha256").update(canonicalize({ prevHash, ...fields, hashTs: ts })).digest("hex");
}

function soHoacNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const scaleHieuLuc = (v) => {
  const n = soHoacNull(v);
  return n === null || n === 0 ? 1 : n;
};
const offsetHieuLuc = (v) => {
  const n = soHoacNull(v);
  return n === null ? 0 : n;
};

/**
 * Hàng DB (đã khoá) × tag trong file ⇒ nguồn gỡ ghim hoặc null. File LUÔN mang đủ trường (validateFile
 * điền writable=false / enabled=true mặc định như server).
 */
export function lyDoGoStopPinCli(dbRow, fileTag) {
  if (dbRow.stop_value === null || dbRow.stop_value === undefined) return null;
  if (fileTag.writable !== true) return "tag_not_writable";
  if (fileTag.enabled !== true) return "tag_disabled";
  if (fileTag.address !== dbRow.address) return "tag_redefined";
  if (fileTag.datatype !== dbRow.dataType) return "tag_redefined";
  if (scaleHieuLuc(fileTag.scale) !== scaleHieuLuc(dbRow.scale)) return "tag_redefined";
  if (offsetHieuLuc(fileTag.offset) !== offsetHieuLuc(dbRow.offset)) return "tag_redefined";
  return null;
}

async function ghiControlAuditTx(tx, e, secPlatform) {
  const base = {
    entityType: "device_tag_stop_pin",
    entityId: String(e.tagId),
    action: "stop_pin_clear",
    actorId: e.actorId ?? null,
    before: e.before,
    after: e.after,
    reason: e.reason,
  };
  if (!secPlatform) {
    await tx`INSERT INTO control_audit_log ("entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason)
             VALUES (${base.entityType}, ${base.entityId}, ${base.action}, ${base.actorId}, ${tx.json(base.before)}, ${tx.json(base.after)}, ${base.reason})`;
    return;
  }
  // Hash-chain: cùng khoá tư vấn với recordAuditEvent ⇒ chuỗi không rẽ nhánh khi app ghi song song.
  await tx`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
  const [prev] = await tx`SELECT hash FROM control_audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1`;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const hashTs = Date.now();
  const hash = computeAuditHash(prevHash, base, hashTs);
  await tx`INSERT INTO control_audit_log ("entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs")
           VALUES (${base.entityType}, ${base.entityId}, ${base.action}, ${base.actorId}, ${tx.json(base.before)}, ${tx.json(base.after)}, ${base.reason},
                   ${prevHash}, ${hash}, ${hashTs})`;
}

/**
 * Gỡ ghim của MỘT tag (hàng đã khoá FOR UPDATE trong `tx`) + audit. `xoa` = tag bị prune (hàng sẽ/đã bị
 * DELETE ⇒ không UPDATE). Trả về dòng audit đã ghi (để in).
 */
export async function goStopPinCliTx(tx, { row, nguon, xoa = false, actorId = null, actorName = "cli", secPlatform = false }) {
  if (!xoa) {
    await tx`UPDATE device_tags SET stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL, "updatedAt" = NOW() WHERE id = ${row.id}`;
  }
  const [cm] = await tx`
    SELECT EXISTS (SELECT 1 FROM commissioning_records
                    WHERE "adapterId" = ${row.adapterId} AND status = 'active'
                      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())) AS c`;
  const commissioningRecheckRequired = cm?.c === true;
  const before = { tagKey: row.tagKey, adapterId: row.adapterId, dataType: row.dataType, stopValue: row.stop_value ?? null };
  const after = {
    tagKey: row.tagKey, adapterId: row.adapterId, dataType: row.dataType, stopValue: null,
    commissioningRecheckRequired, autoClearedBy: nguon,
  };
  const reason = `auto-clear: ${nguon} (${THAO_TAC_CLI}${xoa ? ",prune" : ""})`;
  await ghiControlAuditTx(tx, { tagId: row.id, actorId, before, after, reason }, secPlatform);
  const details = {
    operation: "deviceTag.setStopPin",
    before,
    after,
    metadata: { reason, adapterId: row.adapterId, commissioningRecheckRequired },
    source: "system",
    timestamp: new Date().toISOString(),
  };
  await tx`INSERT INTO audit_logs ("userId", "userName", action, "entityType", "entityId", "entityName", details, status)
           VALUES (${actorId}, ${actorName}, 'deviceTag.setStopPin', 'device_tag', ${row.id}, ${row.tagKey}, ${JSON.stringify(details)}, 'success')`;
  return { tagKey: row.tagKey, nguon };
}
