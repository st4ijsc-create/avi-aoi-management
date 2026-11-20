// PHATLAI-2 (HST 20/11 15:57): ca HÀNH VI cho bước lọc cờ của dongGoi.ts, tách thành mô-đun thuần locMoiTruong.ts (không I/O, không CSDL).
// Bắt hai đột biến sống của PHATLAI: f1 (gộp lại moiTruong thô vào `co` sau locCo) và g1 (dòng báo stderr in giá trị). Mọi giá trị là GIẢ, tự mô tả.
import { describe, expect, it } from "vitest";
import { locMoiTruongFixture } from "./locMoiTruong";

const ENV_GIA = [
  "AI_AGENT_NEN_MOC=true",
  'AI_CODING_MODEL_TASK="code"  # chu thich cuoi dong',
  "AI_AGENT_HOUSEKEEPING_BAT=true",
  "AI_AGENT_API_KEY=khoa-gia-h2a",
  "KHAC_TIEN_TO=khoa-gia-h2c",
].join("\n");

describe("locMoiTruongFixture — lọc cờ agent cho lenh.moiTruong của fixture", () => {
  it("(h1) chỉ giữ cờ qua locCo; bỏ HOUSEKEEPING, tên dáng bí mật, tên ngoài tiền tố; --moi-truong ghi đè/thêm (bắt f1)", () => {
    const r = locMoiTruongFixture(ENV_GIA, "AI_CODING_AUTOLOOP=1,LLAMA_X=khoa-gia-h2b");
    expect(r.co).toEqual({ AI_AGENT_NEN_MOC: "true", AI_CODING_MODEL_TASK: "code", AI_CODING_AUTOLOOP: "1" });
    expect(r.boDi).toEqual(["AI_AGENT_API_KEY", "LLAMA_X"]); // HOUSEKEEPING và KHAC_TIEN_TO không bao giờ vào moiTruong
  });

  it("(h2) dòng báo stderr nêu ĐỦ tên bị bỏ và KHÔNG chứa giá trị nào (bắt g1)", () => {
    const r = locMoiTruongFixture(ENV_GIA, "LLAMA_X=khoa-gia-h2b");
    expect(r.dongBao).toBe("dongGoi: bỏ khỏi lenh.moiTruong (chỉ tên): AI_AGENT_API_KEY, LLAMA_X");
    for (const gt of ["khoa-gia-h2a", "khoa-gia-h2b", "khoa-gia-h2c", "true", "code"]) expect(r.dongBao, gt).not.toContain(gt);
    expect(locMoiTruongFixture("AI_AGENT_NEN_MOC=true", "").dongBao).toBeNull(); // không bỏ gì ⇒ không in
  });

  it("(h3) --moi-truong sai dạng ⇒ ném, thông điệp CHỈ nêu vị trí (không chữ của cặp, không độ dài)", () => {
    let loi = "";
    try { locMoiTruongFixture("", "AI_AGENT_NEN_MOC=true,khoa-gia-h3-khong-dau-bang"); } catch (e) { loi = (e as Error).message; }
    expect(loi).toBe("--moi-truong sai dạng ở cặp thứ 2");
  });
  // PHATLAI-2 commit 4 (HST 17:05): ba ca ghim hành vi hiện có mà kiem-dinh dự đoán đột biến sống (??= thay =; i < 0; bỏ nhánh AI_AGENTIC_).
  it("(h4a) --moi-truong GHI ĐÈ giá trị cùng khoá trong .env", () => {
    expect(locMoiTruongFixture("AI_AGENT_NEN_MOC=true", "AI_AGENT_NEN_MOC=false").co).toEqual({ AI_AGENT_NEN_MOC: "false" });
  });
  it("(h4b) cặp có khoá RỖNG ⇒ sai dạng đúng vị trí", () => {
    expect(() => locMoiTruongFixture("", "AI_AGENT_NEN_MOC=true,=giatri-gia-h4b")).toThrowError(/^--moi-truong sai dạng ở cặp thứ 2$/);
  });
  it("(h4c) cờ tiền tố AI_AGENTIC_ trong .env được giữ", () => {
    expect(locMoiTruongFixture("AI_AGENTIC_ENABLED=true", "").co).toEqual({ AI_AGENTIC_ENABLED: "true" });
  });
});
