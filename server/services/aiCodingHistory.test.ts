/**
 * ★★★ doc 81 · VIỆC 1 — LƯỚI CHO **LỊCH SỬ HỘI THOẠI** Ở CHẾ ĐỘ LẬP TRÌNH.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI — MỘT THAM SỐ VẮNG MẶT, ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `useKbChatStream` gửi `history`, tuyến REST parse nó, `streamAnswer` NHẬN nó — rồi gọi
 * `streamCodingAnswer(question, context, execCtx)`, một chữ ký KHÔNG có chỗ cho nó. Lịch sử bị vứt
 * **100%** ở chế độ lập trình, nên *"giờ làm tiếp phần B"* rơi vào hư không.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY (mỗi cái có một đột biến giết được nó — xem §5)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1 Lịch sử ĐI VÀO prompt (ca dương — không có nó thì mọi ca âm dưới đây TỰ THOẢ).
 *   §2 **NGÂN SÁCH**: khối trả về KHÔNG BAO GIỜ làm prompt cuối vượt trần slot. Ca then chốt là
 *      TỆP LỚN ở đường SỬA — lịch sử phải nhường chỗ, tới mức 0 lượt.
 *   §3 Ưu tiên lượt GẦN NHẤT (cắt từ đầu, không cắt từ đuôi).
 *   §4 Che bí mật TRƯỚC khi đo, và cắt SAU khi che — nếu không, một lượt lịch sử chứa khoá làm
 *      **mọi lượt SỬA TỆP** chết vì `CODING_PROMPT_REDACTED` (đường sửa đòi prompt nguyên văn).
 *   §5 Đối chứng: bỏ từng hàng rào ⇒ ca nào đỏ.
 *
 * ⚠ KHÔNG mock `aiLlamaServerClient`: phép cân ngân sách ở đây PHẢI là chính cái cổng sẽ ném ở
 *   `aiGgufEngine.congNganSachNguCanh`. Mock nó là đo một cái thước khác cái thước cưỡng chế —
 *   đúng lớp lỗi "thiết bị đo nói dối" mà repo này đã trả giá 19 lần.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chuanHoaLichSu,
  dungKhoiLichSu,
  promptSinhMa,
  promptSuaTep,
  personaSuaTep,
  tranTokenChoTep,
  veKhoiLichSu,
  HAU_TO_CAT_LUOT,
  TRAN_KY_TU_MOI_LUOT,
  TRAN_KY_TU_TEP_SUA,
  TRAN_SO_LUOT_LICH_SU,
  type LuotHoiThoai,
} from "./aiCodingAgent";
import { kiemNganSachNguCanh, serverSlotContextTokens } from "./aiLlamaServerClient";

const ENV = [
  "LLAMA_SERVER_CTX", "LLAMA_SERVER_PARALLEL", "LLAMA_SERVER_CTX_PER_SLOT", "GGUF_MAX_CTX",
  "AI_SAFETY_ENABLED",
] as const;
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) delete process.env[k]; });

/**
 * ★ Thu trần slot lại để đo hành vi CẮT.
 *
 * ⚠ Vì sao phải làm thế: với trần thật (32.768) và hai trần của chính module — 8 lượt ×
 * `TRAN_KY_TU_MOI_LUOT` — lịch sử **không bao giờ** vượt quá ~7.000 token, nên trên đường SINH MÃ
 * (prompt gốc chỉ là câu hỏi) nó LUÔN lọt hết. Đó là một tính chất TỐT của thiết kế, nhưng nó cũng
 * có nghĩa là mọi ca "cắt bớt" viết ở trần thật sẽ **tự thoả** — xanh vì không có gì để cắt. Thu
 * trần lại là cách đo đúng cái vị từ đang được canh.
 */
function tranSlot(token: number): void {
  process.env.LLAMA_SERVER_CTX_PER_SLOT = String(token);
}

function luot(n: number, moiLuot = "xin chao"): LuotHoiThoai[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as LuotHoiThoai["role"],
    content: `${moiLuot} ${i + 1}`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CA DƯƠNG: lịch sử THẬT SỰ đi vào prompt", () => {
  it("★★★ nhánh SINH MÃ: prompt cuối CHỨA nội dung lượt trước", () => {
    const ls: LuotHoiThoai[] = [
      { role: "user", content: "viết cho tôi phần A của trình chat LAN" },
      { role: "assistant", content: "đây là phần A: class LanChatServer" },
    ];
    const r = dungKhoiLichSu({
      lichSu: ls,
      systemPrompt: "persona",
      maxTokens: 3000,
      lang: "vi",
      ghepPrompt: (k) => promptSinhMa("giờ làm tiếp phần B", "vi", k),
    });
    expect(r.soLuotGiu, "không giữ lượt nào ⇒ VIỆC 1 chưa làm gì cả").toBe(2);
    const prompt = promptSinhMa("giờ làm tiếp phần B", "vi", r.khoi);
    expect(prompt).toContain("phần A của trình chat LAN");
    expect(prompt).toContain("class LanChatServer");
    expect(prompt).toContain("giờ làm tiếp phần B");
  });

  it("★★ nhánh SỬA TỆP: lịch sử đứng TRƯỚC nội dung tệp (tệp + yêu cầu ở gần cuối prompt)", () => {
    const noiDung = "namespace X { }";
    const khoi = veKhoiLichSu([{ role: "user", content: "MOC_LICH_SU" }], "vi");
    const p = promptSuaTep("src/A.cs", noiDung, "sửa đi", "vi", khoi);
    expect(p.indexOf("MOC_LICH_SU")).toBeLessThan(p.indexOf(noiDung));
    expect(p.indexOf(noiDung)).toBeLessThan(p.indexOf("sửa đi"));
  });

  it("★ không có lịch sử ⇒ prompt GIỐNG HỆT bản trước lượt này (tương thích ngược)", () => {
    expect(promptSinhMa("hỏi", "vi", "")).toBe(promptSinhMa("hỏi", "vi"));
    expect(promptSuaTep("a.ts", "x", "y", "vi", "")).toBe(promptSuaTep("a.ts", "x", "y", "vi"));
    expect(veKhoiLichSu([], "vi"), "danh sách rỗng ⇒ KHÔNG dựng khung rỗng").toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — NGÂN SÁCH: khối trả về không bao giờ đẩy prompt vượt trần slot", () => {
  /**
   * ★★★ CA THEN CHỐT CỦA CẢ VIỆC 1. Đây là kịch bản brief cảnh báo: đường SỬA TỆP đã sát trần,
   * nhồi thêm lịch sử sẽ làm HỎNG một chức năng đang chạy.
   */
  it("★★★ TỆP LỚN ⇒ lịch sử nhường chỗ HẾT (0 lượt), và prompt gốc vẫn lọt", () => {
    /**
     * 57.000 ký tự ở trần THẬT (32.768/slot): ~20.358 token vào + 12.000 token ra = ~32.6k, tức
     * vừa khít — dư địa còn lại nhỏ hơn MỘT lượt lịch sử. Đây là kịch bản brief cảnh báo, đo ở
     * đúng con số của cấu hình đang chạy, KHÔNG phải một trần giả.
     */
    const noiDung = "a".repeat(57_000);
    const heThong = personaSuaTep("vi", "");
    const maxTokens = tranTokenChoTep(noiDung.length);
    const r = dungKhoiLichSu({
      lichSu: luot(8, "x".repeat(2_000)),
      systemPrompt: heThong,
      maxTokens,
      lang: "vi",
      ghepPrompt: (k) => promptSuaTep("big.cs", noiDung, "sửa", "vi", k),
    });
    expect(r.soLuotGiu, "lịch sử KHÔNG được chen vào khi tệp đã ăn hết ngân sách").toBe(0);
    expect(r.soLuotBo).toBeGreaterThan(0);
    expect(r.vuotTruocKhiCoLichSu, "prompt gốc VẪN lọt — thứ bị bỏ là lịch sử, không phải tệp").toBe(false);
    // Và prompt cuối thật sự lọt cổng.
    const canh = kiemNganSachNguCanh({
      systemPrompt: heThong,
      prompt: promptSuaTep("big.cs", noiDung, "sửa", "vi", r.khoi),
      maxTokens,
    });
    expect(canh.vua, "prompt cuối PHẢI lọt — đây là bất biến, không phải may mắn").toBe(true);
  });

  /**
   * ★★★ NỢ CÓ SẴN, ĐO ĐƯỢC — `TRAN_KY_TU_TEP_SUA` CAO HƠN THỨ NGÂN SÁCH CHỞ NỔI.
   * 60.000 ký tự ⇒ ~21.429 token vào; `tranTokenChoTep` xin 12.000 ra ⇒ ~33.900 > 32.768.
   * Tức một tệp ĐÚNG BẰNG trần đã làm `congNganSachNguCanh` NÉM **từ trước lượt này**. Ca này ghim
   * sự thật ấy lại, và ghim luôn việc `dungKhoiLichSu` nay khai nó ra (`vuotTruocKhiCoLichSu`)
   * để người gọi từ chối trung thực thay vì để engine ném một bức tường chữ.
   */
  it("★★★ tệp ĐÚNG BẰNG trần ký tự ⇒ vượt ngân sách NGAY CẢ KHI KHÔNG có lịch sử (nợ có sẵn)", () => {
    const noiDung = "a".repeat(TRAN_KY_TU_TEP_SUA);
    const heThong = personaSuaTep("vi", "");
    const maxTokens = tranTokenChoTep(noiDung.length);
    const canhGoc = kiemNganSachNguCanh({
      systemPrompt: heThong,
      prompt: promptSuaTep("big.cs", noiDung, "sửa", "vi"),
      maxTokens,
    });
    expect(canhGoc.vua, "nếu ca này XANH thì nợ đã được vá ở nơi khác — đọc lại trước khi sửa ca").toBe(false);
    expect(canhGoc.tokenVao + canhGoc.tokenDanhChoTraLoi).toBeGreaterThan(serverSlotContextTokens());

    const r = dungKhoiLichSu({
      lichSu: luot(4),
      systemPrompt: heThong,
      maxTokens,
      lang: "vi",
      ghepPrompt: (k) => promptSuaTep("big.cs", noiDung, "sửa", "vi", k),
    });
    expect(r.vuotTruocKhiCoLichSu, "phải khai ĐÚNG nguyên nhân — tệp, KHÔNG phải lịch sử").toBe(true);
    expect(r.khoi).toBe("");
    expect(r.soLuotGiu).toBe(0);
  });

  it("★★ ngân sách CHẬT ⇒ giữ được ÍT hơn 8 nhưng >0, và prompt cuối vẫn lọt", () => {
    tranSlot(4_096);
    const heThong = "persona ngắn";
    const r = dungKhoiLichSu({
      lichSu: luot(8, "y".repeat(TRAN_KY_TU_MOI_LUOT * 3)),
      systemPrompt: heThong,
      maxTokens: 1_000,
      lang: "vi",
      ghepPrompt: (k) => promptSinhMa("hỏi", "vi", k),
    });
    expect(r.soLuotGiu).toBeLessThan(8);
    expect(r.soLuotGiu, "phải giữ được ÍT NHẤT một lượt — 0 ở đây nghĩa là thước quá chặt").toBeGreaterThan(0);
    const canh = kiemNganSachNguCanh({
      systemPrompt: heThong,
      prompt: promptSinhMa("hỏi", "vi", r.khoi),
      maxTokens: 1_000,
    });
    expect(canh.vua).toBe(true);
  });

  it("★★ trần slot HẸP LẠI (cấu hình) ⇒ số lượt giữ GIẢM — thước bám cấu hình SỐNG, không phải hằng chép tay", () => {
    const goi = () => dungKhoiLichSu({
      lichSu: luot(8, "z".repeat(1_500)),
      systemPrompt: "p", maxTokens: 1_000, lang: "vi",
      ghepPrompt: (k) => promptSinhMa("hỏi", "vi", k),
    });
    tranSlot(32_768);
    const rong = goi().soLuotGiu;
    tranSlot(4_096);
    const hep = goi().soLuotGiu;
    expect(rong).toBe(8);
    expect(hep).toBeLessThan(rong);
  });

  it("★★ ngân sách KHÔNG CÒN GÌ ⇒ 0 lượt, và KHÔNG khai nhầm là 'prompt gốc vượt'", () => {
    // Trần vừa đủ cho prompt gốc + maxTokens, không dư một token nào cho lịch sử.
    const cauHoi = "hỏi ngắn";
    const goc = promptSinhMa(cauHoi, "vi");
    const canhGoc = kiemNganSachNguCanh({ systemPrompt: "p", prompt: goc, maxTokens: 100 });
    tranSlot(canhGoc.tokenVao + 100);
    const r = dungKhoiLichSu({
      lichSu: luot(4), systemPrompt: "p", maxTokens: 100, lang: "vi",
      ghepPrompt: (k) => promptSinhMa(cauHoi, "vi", k),
    });
    expect(r.soLuotGiu).toBe(0);
    expect(r.khoi).toBe("");
    expect(r.vuotTruocKhiCoLichSu, "prompt gốc LỌT — nguyên nhân là hết dư địa, không phải tệp quá to").toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — ƯU TIÊN LƯỢT GẦN NHẤT", () => {
  it("★★★ cắt từ ĐẦU (cũ nhất) đi ra — lượt cuối cùng LUÔN có mặt khi còn giữ được lượt nào", () => {
    tranSlot(4_096);
    // Mỗi lượt mang một MỐC duy nhất để phân biệt được lượt nào bị bỏ.
    const ls: LuotHoiThoai[] = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as LuotHoiThoai["role"],
      content: `MOC_${i + 1} ` + "w".repeat(1_400),
    }));
    const r = dungKhoiLichSu({
      lichSu: ls, systemPrompt: "p", maxTokens: 1_000, lang: "vi",
      ghepPrompt: (k) => promptSinhMa("hỏi", "vi", k),
    });
    expect(r.soLuotGiu).toBeGreaterThan(0);
    expect(r.soLuotGiu).toBeLessThan(8);
    // Lượt CUỐI phải có; lượt ĐẦU phải KHÔNG (đây là phép đo "ưu tiên gần nhất").
    expect(r.khoi).toContain("MOC_8");
    expect(r.khoi).not.toContain("MOC_1");
  });

  it("★★ trần SỐ lượt: quá TRAN_SO_LUOT_LICH_SU ⇒ chỉ giữ phần ĐUÔI", () => {
    const c = chuanHoaLichSu(luot(TRAN_SO_LUOT_LICH_SU + 5));
    expect(c.length).toBe(TRAN_SO_LUOT_LICH_SU);
    expect(c.at(-1)!.content).toContain(String(TRAN_SO_LUOT_LICH_SU + 5));
  });

  it("★ thứ tự trong khối là CŨ → MỚI (model đọc mạch hội thoại theo đúng chiều)", () => {
    const k = veKhoiLichSu(chuanHoaLichSu(luot(3)), "vi");
    expect(k.indexOf("chao 1")).toBeLessThan(k.indexOf("chao 2"));
    expect(k.indexOf("chao 2")).toBeLessThan(k.indexOf("chao 3"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — CHE BÍ MẬT + CẮT LƯỢT", () => {
  /**
   * ★★★ Không có ca này thì lỗ sau đây im lặng: một lượt lịch sử chứa `password=…` đi THÔ vào
   * prompt SỬA TỆP ⇒ `planInference` che nó ⇒ `plan.safeText !== prompt` ⇒ `streamCodingModel`
   * NÉM `CODING_PROMPT_REDACTED` ⇒ **mọi lượt sửa tệp sau đó chết**, với một thông báo nói về TỆP
   * trong khi thủ phạm là LỊCH SỬ. Che ở đây là điều kiện để kỷ luật "prompt nguyên văn" sống sót.
   */
  it("★★★ bí mật trong lịch sử BỊ CHE trước khi vào prompt", () => {
    const c = chuanHoaLichSu([
      { role: "user", content: "kết nối bằng password=SieuBiMat123 nhé" },
      { role: "assistant", content: "token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop.qrstuvwxyz123456" },
    ]);
    const gop = c.map((x) => x.content).join("\n");
    expect(gop).not.toContain("SieuBiMat123");
    expect(gop).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop.qrstuvwxyz123456");
    expect(gop, "phải CÓ dấu vết đã che, không phải xoá trắng").toMatch(/REDACTED/);
  });

  it("★★★ CHE TRƯỚC, CẮT SAU: một bí mật nằm ngay mép trần vẫn bị che (cắt trước sẽ làm bộ che MÙ)", () => {
    const biMat = "password=RatDaiVaRatBiMatLamNhe0123456789";
    // Đặt bí mật vắt qua đúng mốc cắt: cắt trước khi che sẽ chẻ đôi nó ⇒ hết khớp mẫu ⇒ lọt.
    const dem = "d".repeat(TRAN_KY_TU_MOI_LUOT - Math.floor(biMat.length / 2));
    const c = chuanHoaLichSu([{ role: "user", content: dem + biMat }]);
    expect(c[0].content).not.toContain("RatDaiVaRatBiMatLamNhe0123456789");
  });

  it("★★ lượt quá dài BỊ CẮT và nói ra là đã cắt", () => {
    const c = chuanHoaLichSu([{ role: "assistant", content: "q".repeat(TRAN_KY_TU_MOI_LUOT + 500) }]);
    expect(c[0].content.length).toBeLessThanOrEqual(TRAN_KY_TU_MOI_LUOT + HAU_TO_CAT_LUOT.length);
    expect(c[0].content.endsWith(HAU_TO_CAT_LUOT)).toBe(true);
  });

  it("★ đầu vào rác từ client KHÔNG làm sập: role lạ, content không phải chuỗi, rỗng ⇒ bị loại", () => {
    const c = chuanHoaLichSu([
      { role: "system" as unknown as "user", content: "a" },
      { role: "user", content: 123 as unknown as string },
      { role: "user", content: "   " },
      { role: "user", content: "giữ lại" },
    ]);
    expect(c).toEqual([{ role: "user", content: "giữ lại" }]);
    expect(chuanHoaLichSu(undefined)).toEqual([]);
    expect(chuanHoaLichSu(null)).toEqual([]);
    expect(chuanHoaLichSu([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — ĐỐI CHỨNG: các ca trên có phân biệt được không", () => {
  it("★★★ ca §2 KHÔNG tự thoả: với prompt gốc NHỎ, cùng lịch sử ấy được giữ ĐỦ 8 lượt", () => {
    const r = dungKhoiLichSu({
      lichSu: luot(8), systemPrompt: "p", maxTokens: 1000, lang: "vi",
      ghepPrompt: (k) => promptSinhMa("hỏi", "vi", k),
    });
    expect(r.soLuotGiu).toBe(8);
    expect(r.soLuotBo).toBe(0);
    expect(r.vuotTruocKhiCoLichSu).toBe(false);
  });

  it("★★ `ghepPrompt` được gọi với ĐÚNG khối trả về (đo cái sẽ gửi, không phải một xấp xỉ)", () => {
    const thay: string[] = [];
    const r = dungKhoiLichSu({
      lichSu: luot(2), systemPrompt: "p", maxTokens: 1000, lang: "vi",
      ghepPrompt: (k) => { thay.push(k); return promptSinhMa("hỏi", "vi", k); },
    });
    expect(thay[0], "lượt cân ĐẦU TIÊN phải là prompt KHÔNG lịch sử").toBe("");
    expect(thay).toContain(r.khoi);
  });
});
