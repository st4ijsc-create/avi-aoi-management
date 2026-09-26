/**
 * Doc 44 W3-B3 (G3.8) — LOADER: đăng ký 4 template QT vào KHO WORKFLOW FOE HIỆN CÓ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FOE lưu definitions trong DB (bảng orchestration_workflows, upsert-by-ref qua
 * deployWorkflow — foeEngine.ts). Loader này deploy 4 definition as-code:
 *
 *   • Cờ QT_TEMPLATES_ENABLED (default OFF) — OFF ⇒ KHÔNG đăng ký gì (no-op, 0 DB).
 *   • Cần FOE_ENABLED (deployWorkflow tự từ chối khi off) — trả kết quả honest.
 *   • IDEMPOTENT THEO NỘI DUNG: deployWorkflow bump version MỖI lần gọi, nên loader
 *     so hash canonical (bỏ trường version) của definition đang lưu với template —
 *     trùng ⇒ skip (boot lại không sinh version mới vô nghĩa).
 *   • SIM-GATE: khi FOE_SIM_GATE_REQUIRED bật, deploy đi qua override CÓ LÝ DO
 *     (được auditDeploySimGate ghi audit) — template as-code trong repo là nội dung
 *     reviewed; các bước của nó là hitl_gate (không command step) nên không có gì
 *     để mô phỏng trên twin. Không nới lỏng gate nào khác.
 *   • FAIL-SAFE: không bao giờ throw (gọi từ backgroundJobs boot path).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { orchestrationWorkflows } from "../../../../drizzle/schema";
import { deployWorkflow, foeEnabled, hashWorkflowDefinition, type FoeUser } from "../foe/foeEngine";
import type { WorkflowDefinition } from "../foe/workflowModel";
import { listQtTemplates } from "./qtTemplates";

/** Cờ đăng ký template QT — default OFF (an toàn). Đọc tại call time (test-friendly). */
export function qtTemplatesEnabled(): boolean {
  return process.env.QT_TEMPLATES_ENABLED === "true" || process.env.QT_TEMPLATES_ENABLED === "1";
}

const LOADER_USER: FoeUser = { id: 0, role: "system", name: "qt-template-loader" };

/** Hash canonical BỎ version (deployWorkflow tự bump version — không được tính vào so khớp). */
function contentHash(def: WorkflowDefinition): string {
  const { version: _version, ...rest } = def;
  return hashWorkflowDefinition(rest as WorkflowDefinition);
}

export interface RegisterQtTemplatesResult {
  enabled: boolean;
  foeEnabled: boolean;
  /** ref đã deploy (mới hoặc nội dung đổi). */
  registered: string[];
  /** ref bỏ qua vì nội dung trong kho đã trùng template as-code. */
  skipped: string[];
  failed: Array<{ ref: string; message: string }>;
  message?: string;
}

/**
 * Đăng ký (idempotent) 4 template QT-1..4 vào orchestration_workflows.
 * No-op khi QT_TEMPLATES_ENABLED off; honest khi FOE_ENABLED off / DB unavailable.
 */
export async function registerQtTemplates(): Promise<RegisterQtTemplatesResult> {
  const base: RegisterQtTemplatesResult = {
    enabled: qtTemplatesEnabled(),
    foeEnabled: foeEnabled(),
    registered: [],
    skipped: [],
    failed: [],
  };
  if (!base.enabled) {
    return { ...base, message: "QT_TEMPLATES_ENABLED off (default) — không đăng ký template" };
  }
  if (!base.foeEnabled) {
    return { ...base, message: "FOE_ENABLED off — deployWorkflow sẽ từ chối; bật FOE trước khi đăng ký template" };
  }

  try {
    const db = await getDb();
    if (!db) return { ...base, message: "DB unavailable — không đăng ký được template" };

    for (const def of listQtTemplates()) {
      try {
        const [existing] = await db
          .select()
          .from(orchestrationWorkflows)
          .where(eq(orchestrationWorkflows.ref, def.ref))
          .limit(1);
        if (existing?.definitionJson && contentHash(existing.definitionJson as WorkflowDefinition) === contentHash(def)) {
          base.skipped.push(def.ref);
          continue;
        }
        const res = await deployWorkflow(def, LOADER_USER, {
          overrideReason:
            "QT template as-code (doc 44 W3-B3): nội dung reviewed trong repo, các bước là hitl_gate " +
            "(không command step) — không có control-path để mô phỏng twin; override được ghi audit.",
        });
        if (res.ok) {
          base.registered.push(def.ref);
          console.log(`[QtTemplates] registered ${def.ref} v${res.version}`);
        } else {
          base.failed.push({
            ref: def.ref,
            message: res.message ?? res.errors?.map((e) => `${e.path}: ${e.message}`).join("; ") ?? "deploy failed",
          });
        }
      } catch (err) {
        // data-raw-ok: kết quả ĐĂNG KÝ MẪU lúc khởi động. Ai đọc nó là người đang dựng
        // hệ, và họ cần biết template nào hỏng vì lý do kỹ thuật gì.
        base.failed.push({ ref: def.ref, message: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    return { ...base, message: `registerQtTemplates lỗi: ${err instanceof Error ? err.message : String(err)}` };
  }

  console.log(
    `[QtTemplates] register done: ${base.registered.length} registered, ${base.skipped.length} skipped (content-identical), ${base.failed.length} failed`,
  );
  return base;
}
