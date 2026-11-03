/**
 * Đợt 10.4b L4 — phần thuần của bong bóng khi dùng model ngoài (hợp đồng docs/HOP_DONG_10_4B_L4_BONG_BONG.md: T1, T2, T3b, T11, T16).
 */
import { describe, it, expect } from "vitest";
import { dungNguCanhKb } from "@/hooks/useKbChatStream";
import {
  KHOA_NGU_CANH_NGOAI,
  ROUTE_BE_MAT_NGOAI,
  TRAN_VAN_BAN_BYTE,
  catTheoByte,
  catVanBan,
  demByte,
  dungNguCanhNgoai,
  laModelNgoai,
  lichSuNgoai,
  type LuotBongBong,
} from "./bongBongNgoai";

describe("laModelNgoai", () => {
  it("chỉ mã ngoai:<ncc>:<model> hợp lệ", () => {
    expect(laModelNgoai("ngoai:openai_compat:fake-1")).toBe(true);
    expect(laModelNgoai("auto")).toBe(false);
    expect(laModelNgoai("vai-tro:1")).toBe(false);
    expect(laModelNgoai("ngoai:")).toBe(false);
    expect(laModelNgoai("ngoai:x")).toBe(false);
  });
});

describe("dungNguCanhNgoai — T3b: body ở nhánh ngoài chỉ gồm tập khoá L1 cho phép", () => {
  const tat = dungNguCanhKb(dungNguCanhNgoai({ chonModel: "ngoai:a:b", conversationId: 7, uiLanguage: "vi", xacNhanVanHanh: true }));
  it("đúng tập khoá (toEqual) — không máy/trang/đính kèm", () => {
    expect(Object.keys(tat).sort()).toEqual([...KHOA_NGU_CANH_NGOAI].sort());
    expect(tat).toEqual({ route: ROUTE_BE_MAT_NGOAI, uiLanguage: "vi", chonModel: "ngoai:a:b", conversationId: 7, xacNhanVanHanh: true });
  });
  it("chưa xác nhận vận hành ⇒ KHÔNG có khoá xacNhanVanHanh", () => {
    const k = dungNguCanhKb(dungNguCanhNgoai({ chonModel: "ngoai:a:b", conversationId: 7, uiLanguage: "en", xacNhanVanHanh: false }));
    expect("xacNhanVanHanh" in k).toBe(false);
    expect(Object.keys(k).sort()).toEqual(["chonModel", "conversationId", "route", "uiLanguage"]);
  });
  it("route là HẰNG của bề mặt, không phải trang đang đứng", () => {
    expect(ROUTE_BE_MAT_NGOAI).toBe("/ai-chat");
  });
});

describe("lichSuNgoai — T16: chỉ lượt của CHÍNH hội thoại ngoài này", () => {
  const ds: LuotBongBong[] = [
    { type: "user", content: "cục bộ 1" },
    { type: "assistant", content: "cục bộ trả lời" },
    { type: "user", content: "ngoài 1", ngoaiConvId: 5 },
    { type: "assistant", content: "ngoài trả lời 1", ngoaiConvId: 5 },
    { type: "user", content: "hội thoại khác", ngoaiConvId: 9 },
    { type: "assistant", content: "đang stream", ngoaiConvId: 5, streaming: true },
    { type: "assistant", content: "  ", ngoaiConvId: 5 },
  ];
  it("bỏ lượt cục bộ, hội thoại khác, đang stream, rỗng", () => {
    expect(lichSuNgoai(ds, 5)).toEqual([
      { role: "user", content: "ngoài 1" },
      { role: "assistant", content: "ngoài trả lời 1" },
    ]);
  });
  it("hội thoại chưa có lượt ⇒ rỗng (bắt đầu SẠCH)", () => {
    expect(lichSuNgoai(ds, 123)).toEqual([]);
  });
  it("chỉ lấy tối đa N lượt cuối", () => {
    const nhieu: LuotBongBong[] = Array.from({ length: 30 }, (_, i) => ({ type: i % 2 ? "assistant" : "user", content: `m${i}`, ngoaiConvId: 1 }));
    expect(lichSuNgoai(nhieu, 1, 4).map((x) => x.content)).toEqual(["m26", "m27", "m28", "m29"]);
  });
});

describe("catTheoByte — T2: theo BYTE UTF-8, không cắt giữa ký tự", () => {
  it("không cắt khi vừa", () => {
    expect(catTheoByte("abc", 3)).toEqual({ text: "abc", daCat: false });
  });
  it("ASCII cắt đúng byte", () => {
    expect(catTheoByte("abcdef", 4)).toEqual({ text: "abcd", daCat: true });
  });
  it("tiếng Việt (2–3 byte) ở biên: không để lại byte lẻ", () => {
    const s = "Việt Nam đẹp lắm"; // nhiều ký tự 2–3 byte
    for (let n = 0; n <= demByte(s); n++) {
      const kq = catTheoByte(s, n);
      expect(demByte(kq.text)).toBeLessThanOrEqual(n);
      expect(kq.text).not.toContain("�");
      expect(s.startsWith(kq.text)).toBe(true);
    }
  });
  it("emoji 4 byte ở biên: cắt cả ký tự hoặc bỏ cả ký tự", () => {
    const s = "a😀b"; // 1 + 4 + 1 byte
    expect(catTheoByte(s, 1).text).toBe("a");
    expect(catTheoByte(s, 2).text).toBe("a");
    expect(catTheoByte(s, 4).text).toBe("a");
    expect(catTheoByte(s, 5).text).toBe("a😀");
    expect(catTheoByte(s, 6)).toEqual({ text: "a😀b", daCat: false });
    for (let n = 0; n <= 6; n++) expect(catTheoByte(s, n).text).not.toContain("�");
  });
  it("ngưỡng 0 ⇒ rỗng", () => {
    expect(catTheoByte("abc", 0)).toEqual({ text: "", daCat: true });
    expect(catTheoByte("", 0)).toEqual({ text: "", daCat: false });
  });
});

describe("catVanBan — trần TỔNG 16 KB; giữ traLoi, cắt cauHoi trước; T11 cờ 'đã cắt'", () => {
  it("vừa ⇒ giữ nguyên, daCat=false", () => {
    expect(catVanBan({ cauHoi: "hỏi", traLoi: "đáp" })).toEqual({ cauHoi: "hỏi", traLoi: "đáp", daCat: false });
  });
  it("tổng vượt ⇒ tổng byte ≤ trần, cauHoi bị cắt, traLoi giữ", () => {
    const traLoi = "đ".repeat(4000); // 8000 byte
    const cauHoi = "h".repeat(20_000);
    const kq = catVanBan({ cauHoi, traLoi });
    expect(demByte(kq.cauHoi) + demByte(kq.traLoi)).toBeLessThanOrEqual(TRAN_VAN_BAN_BYTE);
    expect(kq.traLoi).toBe(traLoi);
    expect(kq.cauHoi.length).toBe(TRAN_VAN_BAN_BYTE - 8000);
    expect(kq.daCat).toBe(true);
  });
  it("traLoi một mình vượt trần ⇒ cắt traLoi, cauHoi rỗng", () => {
    const kq = catVanBan({ cauHoi: "hỏi", traLoi: "x".repeat(TRAN_VAN_BAN_BYTE + 50) });
    expect(demByte(kq.traLoi)).toBe(TRAN_VAN_BAN_BYTE);
    expect(kq.cauHoi).toBe("");
    expect(kq.daCat).toBe(true);
  });
  it("đúng bằng trần ⇒ KHÔNG báo đã cắt", () => {
    const kq = catVanBan({ cauHoi: "a".repeat(100), traLoi: "b".repeat(TRAN_VAN_BAN_BYTE - 100) });
    expect(kq.daCat).toBe(false);
    expect(demByte(kq.cauHoi) + demByte(kq.traLoi)).toBe(TRAN_VAN_BAN_BYTE);
  });
  it("biên đa byte: không sinh ký tự hỏng", () => {
    const kq = catVanBan({ cauHoi: "😀".repeat(5000), traLoi: "ệ".repeat(5000) });
    expect(kq.cauHoi + kq.traLoi).not.toContain("�");
    expect(demByte(kq.cauHoi) + demByte(kq.traLoi)).toBeLessThanOrEqual(TRAN_VAN_BAN_BYTE);
  });
});
