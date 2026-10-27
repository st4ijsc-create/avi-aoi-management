/**
 * ★ Đợt 10.4 (D5) — NGUỒN của nút kiểm định: máy chủ ĐỌC KHO theo ID (không nhận văn bản từ client) và TỰ suy mức dữ liệu.
 * MẶC ĐỊNH ĐÓNG: nguồn không chứng minh được là kỹ thuật ⇒ `van-hanh`.
 *   • chat  — `ai_chat_conversations` (chủ = userId) + `ai_chat_messages`: tin nhắn ASSISTANT; câu hỏi = tin USER gần nhất trước nó.
 *             Kho chỉ lưu {role, content} và đường stream lưu câu trả lời DO CLIENT gửi ⇒ KHÔNG là provenance ⇒ LUÔN `van-hanh`.
 *   • coding — `ai_coding_sessions` (chủ = userId), `turns` DO CLIENT ghi ⇒ KHÔNG là provenance ⇒ `van-hanh` (dieu-phoi quyết 2026-10-27;
 *             nâng `ky-thuat` chỉ khi có nhật ký lượt do máy chủ ghi — backlog). Lượt chỉ định phải là ASSISTANT.
 *   • agent — `ai_agent_runs` (chủ = userId), `suKien` do MÁY CHỦ ghi (`quanLyLuotChay`) — nguồn DUY NHẤT có provenance: suy từ TẬP TÊN
 *             TOOL đã gọi; chỉ tool ĐỌC MÃ / tra tài liệu mã ⇒ `ky-thuat`; tool khác / lạ ⇒ `van-hanh`. Đáp = `tomTat`, rỗng ⇒ chữ cuối.
 * Không phải chủ / không có / sai dạng ID ⇒ `null` (thủ tục trả NOT_FOUND — không phân biệt "có nhưng của người khác").
 */
import { and, asc, eq } from "drizzle-orm";
import type { MucDuLieu } from "./phanLoai";

export type NguonKiemDinh =
  | { loai: "chat"; cuocTroChuyenId: number; tinNhanId: number }
  | { loai: "agent"; runId: string }
  | { loai: "coding"; phienId: string; chiSoLuot: number };

export interface NoiDungNguon {
  cauHoi: string;
  traLoi: string;
  muc: MucDuLieu;
  beMat: "chat" | "coding" | "agent-turn";
}

/**
 * Tool của vòng agent mà KẾT QUẢ chỉ là mã nguồn / tài liệu lập trình (đọc repo đã cấu hình, chỉ mục API, KB lập trình — `search_docs` không
 * chạm kho vận hành, xem `timTaiLieuAgent.ts`) hoặc không mang dữ liệu (`todo_write`, `remember` đề xuất). Mọi tool KHÁC — kể cả ghi tệp,
 * `run_command` (đầu ra lệnh tuỳ ý) và tool chưa biết — ⇒ `van-hanh`.
 */
export const TOOL_AGENT_KY_THUAT: ReadonlySet<string> = new Set([
  "read_file",
  "list_dir",
  "find_files",
  "grep",
  "find_symbol",
  "search_code",
  "search_docs",
  "lookup_api",
  "compile_st",
  "todo_write",
  "remember",
]);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mức của một lượt agent từ sự kiện đã lưu: có tool ngoài tập kỹ thuật ⇒ `van-hanh`. Sự kiện hỏng ⇒ `van-hanh`. */
export function mucCuaLuotAgent(suKien: unknown): MucDuLieu {
  if (!Array.isArray(suKien)) return "van-hanh";
  for (const m of suKien) {
    const e = (m as { suKien?: unknown })?.suKien as { loai?: unknown; goi?: { ten?: unknown }; ten?: unknown } | undefined;
    if (!e || typeof e !== "object") return "van-hanh";
    const ten = e.loai === "goi-tool" ? e.goi?.ten : e.loai === "ket-qua-tool" ? e.ten : undefined;
    if (ten !== undefined && (typeof ten !== "string" || !TOOL_AGENT_KY_THUAT.has(ten))) return "van-hanh";
  }
  return "ky-thuat";
}

function chuCuoiAgent(suKien: unknown): string {
  if (!Array.isArray(suKien)) return "";
  for (let i = suKien.length - 1; i >= 0; i--) {
    const e = (suKien[i] as { suKien?: { loai?: unknown; noiDung?: unknown } })?.suKien;
    if (e?.loai === "chu" && typeof e.noiDung === "string" && e.noiDung.trim()) return e.noiDung;
  }
  return "";
}

export async function docNguonKiemDinh(userId: number, nguon: NguonKiemDinh): Promise<NoiDungNguon | null> {
  if (nguon.loai === "agent") {
    if (!RE_UUID.test(nguon.runId)) return null;
    const { docHangLuotChay } = await import("../../../db/aiAgentRuns");
    const h = await docHangLuotChay(userId, nguon.runId);
    if (!h) return null;
    const traLoi = (h.tomTat ?? "").trim() || chuCuoiAgent(h.suKien);
    return { cauHoi: h.cauHoi, traLoi, muc: mucCuaLuotAgent(h.suKien), beMat: "agent-turn" };
  }
  if (nguon.loai === "coding") {
    if (!RE_UUID.test(nguon.phienId) || !Number.isInteger(nguon.chiSoLuot) || nguon.chiSoLuot < 0) return null;
    const { moPhien } = await import("../../../db/aiCodingSessions");
    const p = await moPhien(userId, nguon.phienId);
    const luot = p?.turns[nguon.chiSoLuot];
    if (!p || !luot || luot.role !== "assistant") return null;
    let cauHoi = "";
    for (let i = nguon.chiSoLuot - 1; i >= 0; i--) {
      if (p.turns[i]!.role === "user") {
        cauHoi = p.turns[i]!.content;
        break;
      }
    }
    return { cauHoi, traLoi: luot.content, muc: "van-hanh", beMat: "coding" };
  }
  // chat
  if (!Number.isInteger(nguon.cuocTroChuyenId) || !Number.isInteger(nguon.tinNhanId)) return null;
  const [{ getDb }, { aiChatConversations, aiChatMessages }] = await Promise.all([import("../../../db/connection"), import("../../../../drizzle/schema/ai")]);
  const db = await getDb();
  if (!db) return null;
  const [cv] = await db
    .select({ id: aiChatConversations.id })
    .from(aiChatConversations)
    .where(and(eq(aiChatConversations.id, nguon.cuocTroChuyenId), eq(aiChatConversations.userId, userId)))
    .limit(1);
  if (!cv) return null;
  const ds = await db
    .select({ id: aiChatMessages.id, role: aiChatMessages.role, content: aiChatMessages.content })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.conversationId, cv.id))
    .orderBy(asc(aiChatMessages.createdAt), asc(aiChatMessages.id));
  const i = ds.findIndex((m) => m.id === nguon.tinNhanId);
  if (i < 0 || ds[i]!.role !== "assistant") return null;
  let cauHoi = "";
  for (let j = i - 1; j >= 0; j--) {
    if (ds[j]!.role === "user") {
      cauHoi = ds[j]!.content ?? "";
      break;
    }
  }
  return { cauHoi, traLoi: ds[i]!.content ?? "", muc: "van-hanh", beMat: "chat" };
}
