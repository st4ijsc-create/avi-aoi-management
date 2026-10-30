import { describe, expect, it } from "vitest";
import { GIOI_HAN_PHIEN } from "@shared/aiCodingSession";
import { chiSoLuotPhien } from "./chiSoLuotPhien";

const u = (c: string) => ({ role: "user", content: c });
const a = (c: string) => ({ role: "assistant", content: c });

describe("chiSoLuotPhien", () => {
  it("phiên ngắn: chỉ số lưu = chỉ số transcript; lượt user ⇒ null; ngoài khoảng ⇒ null", () => {
    const tr = [u("q1"), a("a1"), u("q2"), a("a2")];
    expect(chiSoLuotPhien(tr, 1)).toBe(1);
    expect(chiSoLuotPhien(tr, 3)).toBe(3);
    expect(chiSoLuotPhien(tr, 0)).toBeNull();
    expect(chiSoLuotPhien(tr, 2)).toBeNull();
    expect(chiSoLuotPhien(tr, 4)).toBeNull();
    expect(chiSoLuotPhien(tr, -1)).toBeNull();
  });
  it("vượt trần SỐ LƯỢT: bản lưu cắt phần ĐẦU ⇒ chỉ số lệch đúng phần bị cắt; lượt đã bị cắt ⇒ null", () => {
    const n = GIOI_HAN_PHIEN.SO_LUOT + 6; // chẵn/lẻ không quan trọng: kiểm tra theo role
    const tr = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? u(`q${i}`) : a(`a${i}`)));
    const cat = n - GIOI_HAN_PHIEN.SO_LUOT;
    expect(chiSoLuotPhien(tr, 1)).toBeNull(); // trợ lý nhưng đã bị cắt khỏi bản lưu
    const ia = tr.findIndex((x, i) => i >= cat && x.role === "assistant");
    expect(chiSoLuotPhien(tr, ia)).toBe(ia - cat);
    expect(chiSoLuotPhien(tr, n - 1)).toBe(n - 1 - cat);
  });
  it("transcript rỗng ⇒ null", () => expect(chiSoLuotPhien([], 0)).toBeNull());
});
