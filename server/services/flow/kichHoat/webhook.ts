/**
 * ★★ Đợt 8.1 Task 4b — KÍCH HOẠT WEBHOOK của Luồng AI: node `kich-hoat.webhook` + cấp token + xử lý một lượt gọi.
 *
 * Tuyến REST: `POST /api/flow/webhook/:flowId/:nodeId` (`server/routes/flowWebhookApi.ts`), header `x-flow-token`.
 *   • token THEO LUỒNG, sinh khi bật luồng (lần đầu, hoặc `xoay`), 32 byte ngẫu nhiên base64url; CSDL chỉ giữ sha256 hex
 *     (`ai_flow_webhooks`, mig 0402); so sánh băm bằng `timingSafeEqual` (luồng không có token ⇒ vẫn so với băm giả để
 *     thời gian trả lời không lộ luồng nào tồn tại);
 *   • KHÔNG có xác thực phiên — token là chứng thực duy nhất (Global Constraints kế hoạch 8.1);
 *   • thân JSON (đối tượng) ≤ 256 KB ⇒ items `[{ json: thân }]` (dữ liệu KHÔNG TIN CẬY — node AI bọc nó trong khối dữ liệu);
 *   • header `idempotency-key` (tuỳ chọn) ⇒ `idempotencyKey = flowId:nodeId:<khoá>` — bên gửi thử lại không tạo lượt đôi.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowVersions, aiFlowWebhooks, aiFlows } from "../../../../drizzle/schema";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { dangKyNut } from "../dangKyNut";
import { laTrungKhoa } from "./lich";

export const LOAI_WEBHOOK = "kich-hoat.webhook";
export const TRAN_THAN_WEBHOOK = 256 * 1024;

dangKyNut({
  type: LOAI_WEBHOOK,
  typeVersion: 1,
  laKichHoat: true,
  congVao: [],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(_t, ngu) {
    return { main: ngu.inputs.main ?? [{ json: {} }] };
  },
});

export const bamToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

const BAM_GIA = bamToken("khong-co-luong-nay");

/** Luồng có node webhook (bật, không tắt) trong định nghĩa này không. */
export function coNodeWebhook(def: FlowDefinition | null | undefined): boolean {
  return (def?.nodes ?? []).some((n) => n.type === LOAI_WEBHOOK && !n.disabled);
}

/**
 * Cấp token cho luồng: chưa có ⇒ sinh; `xoay` ⇒ sinh lại (token cũ hết hiệu lực ngay). Trả token THÔ (đúng một lần) hoặc
 * `null` nếu đã có và không xoay.
 */
export async function capTokenWebhook(flowId: string, xoay = false): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = bamToken(token);
  if (xoay) {
    await db.insert(aiFlowWebhooks).values({ flowId, tokenHash }).onConflictDoUpdate({ target: aiFlowWebhooks.flowId, set: { tokenHash, createdAt: new Date() } });
    return token;
  }
  const r = await db.insert(aiFlowWebhooks).values({ flowId, tokenHash }).onConflictDoNothing().returning({ flowId: aiFlowWebhooks.flowId });
  return r.length ? token : null;
}

export async function coTokenWebhook(flowId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const r = await db.select({ f: aiFlowWebhooks.flowId }).from(aiFlowWebhooks).where(eq(aiFlowWebhooks.flowId, flowId));
  return r.length > 0;
}

export type KetQuaWebhook =
  | { ma: 202; runId: string; trung: boolean }
  | { ma: 400 | 401 | 404 | 409 | 413 | 429 | 503; code: string; thongDiep: string };

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Một lượt gọi webhook — thuần dữ liệu (tuyến REST chỉ dịch kết quả ra HTTP; lưới gọi được trực tiếp). */
export async function xuLyWebhook(y: { flowId: string; nodeId: string; token: unknown; than: unknown; kichThuoc?: number; idemKey?: unknown }): Promise<KetQuaWebhook> {
  const db = await getDb();
  if (!db) return { ma: 503, code: "DB_UNAVAILABLE", thongDiep: "không có kết nối CSDL" };
  const hopLeId = RE_ID.test(y.flowId) && RE_ID.test(y.nodeId);
  const [hang] = hopLeId ? await db.select({ h: aiFlowWebhooks.tokenHash }).from(aiFlowWebhooks).where(eq(aiFlowWebhooks.flowId, y.flowId)) : [];
  const bamDung = Buffer.from(hang?.h ?? BAM_GIA, "hex");
  const bamGui = Buffer.from(bamToken(typeof y.token === "string" ? y.token : ""), "hex");
  const khop = timingSafeEqual(bamDung, bamGui) && !!hang && typeof y.token === "string" && y.token.length > 0;
  if (!khop) return { ma: 401, code: "AUTH_REQUIRED", thongDiep: "token webhook sai hoặc thiếu" };

  const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, y.flowId));
  if (!f?.enabled || f.activeVersion == null) return { ma: 409, code: "FEATURE_DISABLED", thongDiep: "luồng đang tắt" };
  const [v] = await db
    .select({ d: aiFlowVersions.definition })
    .from(aiFlowVersions)
    .where(and(eq(aiFlowVersions.flowId, y.flowId), eq(aiFlowVersions.version, f.activeVersion)));
  const nut = (v?.d as FlowDefinition | undefined)?.nodes.find((n) => n.id === y.nodeId);
  if (!nut || nut.type !== LOAI_WEBHOOK || nut.disabled) return { ma: 404, code: "ENTITY_NOT_FOUND", thongDiep: "luồng không có node webhook này ở phiên bản hoạt động" };

  if ((y.kichThuoc ?? 0) > TRAN_THAN_WEBHOOK) return { ma: 413, code: "INVALID_VALUE", thongDiep: "thân vượt 256 KB" };
  const than = y.than ?? {};
  if (typeof than !== "object" || Array.isArray(than)) return { ma: 400, code: "INVALID_VALUE", thongDiep: "thân phải là một đối tượng JSON" };
  if (Buffer.byteLength(JSON.stringify(than), "utf8") > TRAN_THAN_WEBHOOK) return { ma: 413, code: "INVALID_VALUE", thongDiep: "thân vượt 256 KB" };

  let idempotencyKey: string | undefined;
  if (y.idemKey !== undefined && y.idemKey !== "") {
    const k = String(y.idemKey);
    if (!/^[\x21-\x7e]{1,100}$/.test(k)) return { ma: 400, code: "INVALID_VALUE", thongDiep: "idempotency-key không hợp lệ" };
    const goc = `${y.flowId}:${y.nodeId}:${k}`;
    idempotencyKey = goc.length <= 128 ? goc : `sha256:${createHash("sha256").update(goc).digest("hex")}`;
  }
  const { batDauRun } = await import("../dongCo");
  try {
    const runId = await batDauRun({
      flowId: y.flowId,
      version: f.activeVersion,
      nutKichHoat: y.nodeId,
      triggerKind: "webhook",
      idempotencyKey,
      items: [{ json: than as Record<string, unknown> }],
    });
    return { ma: 202, runId, trung: false };
  } catch (e) {
    if (idempotencyKey && laTrungKhoa(e)) {
      const [r] = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(eq(aiFlowRuns.idempotencyKey, idempotencyKey));
      if (r) return { ma: 202, runId: r.id, trung: true };
    }
    // M5: luồng đã đủ số lượt đồng thời (maxConcurrentRuns) ⇒ 429 — người gửi thử lại sau; KHÔNG xếp hàng.
    if (e instanceof Error && e.name === "LoiLuong" && (e as { code?: string }).code === "QUA_TRAN_DONG_THOI") {
      return { ma: 429, code: "RATE_LIMITED", thongDiep: e.message };
    }
    throw e;
  }
}
