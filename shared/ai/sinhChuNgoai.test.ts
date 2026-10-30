import { describe, expect, it } from "vitest";
import { CHON_MODEL_RE } from "../../server/services/ai/chonModel/kieu";
import { HTTP_LOI_TRUOC_SSE, RE_CHON_MODEL_NGOAI, thongTinNgoaiInput } from "./sinhChuNgoai";

describe("hợp đồng sinh chữ model ngoài (shared)", () => {
  it("RE_CHON_MODEL_NGOAI khớp ĐÚNG nhánh `ngoai:` của CHON_MODEL_RE (một hình dạng, hai nơi)", () => {
    for (const s of ["ngoai:anthropic:claude-x", "ngoai:openai_compat:gpt-4.1:mini", "ngoai:a:b"]) {
      expect(RE_CHON_MODEL_NGOAI.test(s), s).toBe(true);
      expect(CHON_MODEL_RE.test(s), s).toBe(true);
    }
    for (const s of ["ngoai:anthropic", "ngoai::x", "auto", "vai-tro:chat", "ngoai:Anthropic:x", "ngoai:a:b c", `ngoai:a:${"x".repeat(97)}`]) {
      expect(RE_CHON_MODEL_NGOAI.test(s), s).toBe(false);
    }
  });
  it("thongTinNgoaiInput strict: beMat trong danh sách; khoá lạ ⇒ lỗi", () => {
    expect(thongTinNgoaiInput.safeParse({ chonModel: "ngoai:anthropic:claude-x", beMat: "chat" }).success).toBe(true);
    expect(thongTinNgoaiInput.safeParse({ chonModel: "ngoai:anthropic:claude-x", beMat: "bong-bong" }).success).toBe(false);
    expect(thongTinNgoaiInput.safeParse({ chonModel: "ngoai:anthropic:claude-x", beMat: "chat", mucDuLieu: "ky-thuat" }).success).toBe(false);
    expect(thongTinNgoaiInput.safeParse({ chonModel: "auto", beMat: "chat" }).success).toBe(false);
  });
  it("HTTP lỗi trước SSE: 428 xác nhận vận hành; 403 / 404 / 429 / 409 theo hợp đồng", () => {
    expect(HTTP_LOI_TRUOC_SSE).toMatchObject({ CAN_XAC_NHAN_VAN_HANH: 428, NGOAI_DU_LIEU_VAN_HANH: 403, NGOAI_KHONG_TON_TAI: 404, NGOAI_VUOT_TRAN: 429, NGOAI_DANG_CHAY: 409 });
  });
});
