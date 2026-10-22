/**
 * ★★ Đợt 9 (2026-10-21) — VÒNG KIỂM BIÊN DỊCH ST cho hai bề mặt tương tác của màn lập trình: trợ lý (`tro-ly`: câu trả lời có khối
 * ```st) và Cmd+K / sửa tại chỗ (`cmdk`: bản `modified` của một tệp .st/.scl trước khi dựng thẻ diff). Lõi ở
 * `ai/st/kiemBienDichSt.ts` (do-model; KHÔNG đổi chữ ký) — tệp này chỉ là LÁT MỎNG phát sự kiện SSE `kiem_bien_dich`:
 *
 *   `{type:"kiem_bien_dich", phase:"dang-kiem"}`  — ngay trước khi biên dịch (client hiện chỉ báo tiến trình);
 *   `{type:"kiem_bien_dich", phase:"xong", ketQua}` — kết cục (nhãn hiển thị do CLIENT dựng từ số liệu, đủ vi/en/zh).
 *
 * Luật: cờ `AI_KIEM_BIEN_DICH_ST` tắt (mặc định) ⇒ KHÔNG một sự kiện / một byte nào đổi. Không có mã ST ⇒ không phát gì. Không thay lặng
 * lẽ: bản đã sửa luôn đi kèm `cauTraLoiDau` (nút "xem bản đầu"). Không bao giờ ném (trừ huỷ) — hạ tầng hỏng ⇒ "khong-kiem-duoc".
 * ⚠ KHOẢNG TRỐNG AUDIT (dieu-phoi xác nhận 2026-10-21): đường KB coding KHÔNG ghi `ai_llm_audit` ở đâu cả (chỉ `aiGateway.routeInference` ghi), nên
 * vòng kiểm này cũng KHÔNG có `auditSnippet` như `/v1` (`auditKiemBienDich`). Không bịa chỗ ghi; chờ điểm ghi audit chung cho đường KB coding.
 * Tên tệp khớp `aiLocalKnowledge*.ts` CÓ CHỦ Ý: lưới `aiLocalKnowledgeApi.sseCensus` đếm điểm phát ở các tệp này.
 */
import { kiemBienDichBat, kiemVaSuaST, type KetQuaKiemBienDichST } from "./ai/st/kiemBienDichSt";
import { trichMaST } from "./ai/st/trichMaST";
import { rutChuCoCanh, streamCodingModel } from "./aiCodingAgent";
import type { KbLanguage, StreamEvent } from "./aiLocalKnowledgeService";

export type BeMatKiemST = "tro-ly" | "cmdk";

/** Gói gửi client — chỉ số liệu + chẩn đoán đã có sẵn (không mã nguồn trừ `cauTraLoiDau`/`cauTraLoiCuoi` mà người dùng vốn thấy). */
export interface KiemBienDichDto {
  trangThai: KetQuaKiemBienDichST["trangThai"];
  lyDo: string | null;
  phuongNgu: "st" | "scl" | null;
  soVong: number;
  soLoiDaSua: number;
  chanDoan: { tep: string | null; dong: number | null; cot: number | null; ma: string | null; thongDiep: string }[];
  /** Bản ĐẦU model viết, chỉ khi bản trả về khác nó (nút "xem bản đầu"). */
  cauTraLoiDau: string | null;
  msThem: number;
}

export function dtoKiemBienDich(k: KetQuaKiemBienDichST): KiemBienDichDto {
  return {
    trangThai: k.trangThai,
    lyDo: k.lyDo,
    phuongNgu: k.phuongNgu,
    soVong: k.soVong,
    soLoiDaSua: k.soLoiDaSua,
    chanDoan: k.chanDoanCuoi.slice(0, 20).map((d) => ({ tep: d.tep, dong: d.dong, cot: d.cot, ma: d.ma, thongDiep: String(d.thongDiep).slice(0, 300) })),
    // bản ĐẦU chỉ khi bản trả về KHÁC bản đầu (đã sửa, hoặc còn lỗi nhưng là bản ít lỗi hơn) — để người dùng xem lại, không thay lặng lẽ.
    cauTraLoiDau: (k.trangThai === "da-sua" || k.trangThai === "con-loi") && k.cauTraLoiCuoi !== k.cauTraLoiDau ? k.cauTraLoiDau : null,
    msThem: k.msThem,
  };
}

/**
 * Chạy vòng kiểm cho `cauTraLoi`. Cờ tắt / không có mã ST ⇒ trả `null` KHÔNG phát gì. Còn lại: phát `dang-kiem`, chạy, phát `xong`,
 * trả kết cục (người gọi quyết định thay bản đã sửa / đính khối bổ sung).
 */
export async function* chayKiemBienDichST(y: {
  beMat: BeMatKiemST;
  cauTraLoi: string;
  /** Hỏi lại model trong CÙNG hội thoại: nhận tin sửa (lỗi biên dịch) + câu trả lời trước ⇒ câu trả lời mới. */
  goiLai: (tinSua: string, lanTruoc: string) => Promise<string>;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent, KetQuaKiemBienDichST | null> {
  if (!kiemBienDichBat(y.beMat)) return null;
  if (trichMaST(y.cauTraLoi).length === 0) return null;
  yield { type: "kiem_bien_dich", phase: "dang-kiem" };
  const k = await kiemVaSuaST({ cauTraLoi: y.cauTraLoi, goiLai: y.goiLai, signal: y.signal });
  if (k.trangThai === "bo-qua") return null;
  yield { type: "kiem_bien_dich", phase: "xong", ketQua: dtoKiemBienDich(k) };
  return k;
}

/** `goiLai` mặc định: một lượt model KHÔNG suy luận, prompt = prompt gốc + câu trả lời trước + phản hồi của trình biên dịch. */
export function goiLaiBangModel(y: {
  heThong: string;
  promptGoc: string;
  maxTokens: number;
  userId?: number;
  tacVu?: unknown;
  signal?: AbortSignal;
}): (tinSua: string, lanTruoc: string) => Promise<string> {
  return async (tinSua, lanTruoc) => {
    const prompt = `${y.promptGoc}\n\n[Câu trả lời trước của bạn]\n${lanTruoc}\n\n[Phản hồi của trình biên dịch]\n${tinSua}`;
    const it = rutChuCoCanh(
      streamCodingModel({
        auditTask: "kb_kiem_st_sua", // ★ Đợt 9 — lượt hỏi-lại của vòng kiểm biên dịch ST
        tacVu: y.tacVu,
        systemPrompt: y.heThong,
        prompt,
        maxTokens: y.maxTokens,
        disableThinking: true,
        userId: y.userId,
        ...(y.signal ? { signal: y.signal } : {}),
      }),
    );
    for (;;) {
      const n = await it.next();
      if (n.done) {
        if (n.value.degraded || !n.value.text.trim()) throw new Error("model_khong_tra_loi");
        return n.value.text;
      }
    }
  };
}

/** Persona ngắn cho lượt hỏi-lại-sau-biên-dịch của Cmd+K (không dùng persona sinh mã đầy đủ: lượt này chỉ sửa lỗi cú pháp). */
const HE_THONG_SUA_ST =
  "Bạn là kỹ sư PLC IEC 61131-3. Bạn nhận một tệp Structured Text và lỗi biên dịch của nó; hãy sửa ĐÚNG các lỗi biên dịch, " +
  "giữ nguyên ý định yêu cầu ban đầu, và trả lại ĐẦY ĐỦ tệp trong MỘT khối ```st … ```, không thêm khối khác.";

/** `goiLai` cho Cmd+K: prompt gốc = yêu cầu của người dùng + tên tệp (bản đang kiểm nằm ở "câu trả lời trước"). */
export function goiLaiSuaTep(y: { question: string; relPath: string; userId?: number; tacVu?: unknown; signal?: AbortSignal }): (tinSua: string, lanTruoc: string) => Promise<string> {
  return goiLaiBangModel({
    heThong: HE_THONG_SUA_ST,
    promptGoc: "Yêu cầu sửa tệp " + y.relPath + ":" + String.fromCharCode(10) + y.question.slice(0, 4000),
    maxTokens: 12_000,
    userId: y.userId,
    tacVu: y.tacVu,
    signal: y.signal,
  });
}

/** Bóc nội dung tệp từ câu trả lời có khối ST (khối ĐẦU TIÊN — lượt sửa được yêu cầu trả đúng một khối). `null` nếu không có. */
export function boTepTuCauTraLoi(chu: string): string | null {
  const k = trichMaST(chu);
  return k.length > 0 && k[0]!.ma.trim() ? k[0]!.ma : null;
}

const w = (l: KbLanguage, vi: string, en: string, zh: string) => (l === "en" ? en : l === "zh" ? zh : vi);

/**
 * Khối BỔ SUNG nối vào câu trả lời của trợ lý (được lưu cùng phiên — chạy lại phiên cũ vẫn thấy). `sach` ⇒ `""` (chỉ nhãn client).
 * `da-sua` ⇒ nhãn + bản đã sửa; `con-loi` ⇒ danh sách lỗi còn lại (bản trả lời GIỮ NGUYÊN — không thay lặng lẽ).
 */
export function khoiBoSungSauBienDich(k: KetQuaKiemBienDichST, language: KbLanguage): string {
  if (k.trangThai === "da-sua") {
    const tieuDe = w(language, "Bản đã sửa sau biên dịch", "Version corrected after compiling", "编译后修正的版本");
    const nhan = w(
      language,
      `Đã tự sửa ${k.soLoiDaSua} lỗi biên dịch (RuSTy) sau ${k.soVong} vòng.`,
      `Auto-fixed ${k.soLoiDaSua} compile error(s) (RuSTy) after ${k.soVong} round(s).`,
      `经 ${k.soVong} 轮自动修复了 ${k.soLoiDaSua} 个编译错误（RuSTy）。`,
    );
    return `\n\n---\n**${tieuDe}** — ${nhan}\n\n${k.cauTraLoiCuoi}`;
  }
  if (k.trangThai === "con-loi") {
    const dong = k.chanDoanCuoi
      .filter((d) => d.mucDo === "error")
      .slice(0, 20)
      .map((d) => `${d.tep ?? "?"}:${d.dong ?? "?"}:${d.cot ?? "?"} ${d.ma ? `error[${d.ma}]` : "error"}: ${d.thongDiep}`)
      .join("\n");
    const tieuDe = w(language, "Kết quả biên dịch thử", "Trial compile result", "试编译结果");
    const nhan = w(language, "Mã ST còn lỗi biên dịch (RuSTy):", "The ST code still has compile errors (RuSTy):", "ST 代码仍有编译错误（RuSTy）：");
    return `\n\n---\n**${tieuDe}** — ${nhan}\n\`\`\`text\n${dong}\n\`\`\``;
  }
  return "";
}
