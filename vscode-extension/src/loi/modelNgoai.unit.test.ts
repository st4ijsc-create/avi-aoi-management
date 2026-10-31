/** Đợt 10.4b-E — logic thuần của model ngoài ở extension. */
import { describe, expect, it } from "vitest";
import { phanTichMarkdown } from "./markdownAnToan";
import { canXacNhanVanHanh, docLoiTruocSse, docVet, dungThanNgoai, huyHieuNguon, khoaDongY, laChonNgoai, lamKhongTinCay, lamSachVanBanNgoai, thongDiepLoiNgoai } from "./modelNgoai";

describe("laChonNgoai", () => {
  it("chỉ mã ngoai:<ncc>:<model> hợp lệ", () => {
    expect(laChonNgoai("ngoai:openai_compat:gpt-x")).toBe(true);
    expect(laChonNgoai("auto")).toBe(false);
    expect(laChonNgoai("vai-tro:coding")).toBe(false);
    expect(laChonNgoai("ngoai:BAD CHARS:x")).toBe(false);
    expect(laChonNgoai(undefined)).toBe(false);
  });
});

describe("dungThanNgoai", () => {
  const base = { cauHoi: "Q", lichSu: [{ role: "user" as const, content: "a" }, { role: "assistant" as const, content: "b" }], ngonNgu: "vi", chonModel: "ngoai:p:m", conversationId: 7 };
  it("★★★ KHÔNG ngữ cảnh workspace / codingMode / projectId / công cụ — chỉ câu hỏi + lịch sử + cờ", () => {
    const t = dungThanNgoai({ ...base, xacNhanVanHanh: false }) as { question: string; history: unknown[]; context: Record<string, unknown> };
    expect(t.question).toBe("Q");
    expect(t.history).toEqual([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
    expect(Object.keys(t.context).sort()).toEqual(["chonModel", "conversationId", "route", "uiLanguage"]);
    expect(Object.keys(t).sort()).toEqual(["context", "history", "question", "userRole"]);
  });
  it("xacNhanVanHanh chỉ có khi true", () => {
    expect((dungThanNgoai({ ...base, xacNhanVanHanh: true }) as { context: Record<string, unknown> }).context.xacNhanVanHanh).toBe(true);
    expect("xacNhanVanHanh" in (dungThanNgoai({ ...base, xacNhanVanHanh: false }) as { context: object }).context).toBe(false);
  });
  it("lịch sử chỉ giữ role+content (không rò trường lạ)", () => {
    const t = dungThanNgoai({ ...base, lichSu: [{ role: "user", content: "x", bi_mat: "S" } as never], xacNhanVanHanh: false }) as { history: unknown[] };
    expect(JSON.stringify(t.history)).not.toContain("bi_mat");
  });
});

describe("lỗi trước SSE", () => {
  it("docLoiTruocSse: cần code in hoa; tranVuot chuỗi; còn lại null", () => {
    expect(docLoiTruocSse(428, { success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" })).toEqual({ status: 428, code: "CAN_XAC_NHAN_VAN_HANH" });
    expect(docLoiTruocSse(429, { code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" })).toEqual({ status: 429, code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" });
    expect(docLoiTruocSse(500, { code: "lower" })).toBeNull();
    expect(docLoiTruocSse(500, null)).toBeNull();
    expect(docLoiTruocSse(500, { code: 5 })).toBeNull();
  });
  it("canXacNhanVanHanh: phải ĐÚNG 428 + mã", () => {
    expect(canXacNhanVanHanh({ status: 428, code: "CAN_XAC_NHAN_VAN_HANH" })).toBe(true);
    expect(canXacNhanVanHanh({ status: 403, code: "CAN_XAC_NHAN_VAN_HANH" })).toBe(false);
    expect(canXacNhanVanHanh({ status: 428, code: "KHAC" })).toBe(false);
    expect(canXacNhanVanHanh(null)).toBe(false);
  });
  it("thongDiepLoiNgoai: câu theo mã, trần theo loại, mã lạ kèm mã", () => {
    expect(thongDiepLoiNgoai("NGOAI_DU_LIEU_VAN_HANH")).toContain("chưa cho phép");
    expect(thongDiepLoiNgoai("NGOAI_VUOT_TRAN", "lan-phut")).toContain("số lần gọi mỗi phút");
    expect(thongDiepLoiNgoai("NGOAI_VUOT_TRAN")).toContain("một trần sử dụng");
    expect(thongDiepLoiNgoai("X_LA")).toContain("X_LA");
  });
});

describe("vết + huy hiệu", () => {
  it("docVet: sạch; thiếu ncc/model ⇒ null; số âm/NaN ⇒ null từng trường", () => {
    expect(docVet({ nhaCungCap: "p", model: "m", tokenVao: 10, tokenRa: 5, chiPhiUocUsd: 0.5, callId: 9 })).toEqual({ nhaCungCap: "p", model: "m", tokenVao: 10, tokenRa: 5, chiPhiUocUsd: 0.5 });
    expect(docVet({ model: "m" })).toBeNull();
    expect(docVet(null)).toBeNull();
    expect(docVet({ nhaCungCap: "p", model: "m", tokenVao: -1, tokenRa: Number.NaN, chiPhiUocUsd: "1" })).toEqual({ nhaCungCap: "p", model: "m", tokenVao: null, tokenRa: null, chiPhiUocUsd: null });
  });
  it("huyHieuNguon: chỉ meta ⇒ «Model ngoài · ncc/model»; có vết ⇒ thêm token + USD", () => {
    expect(huyHieuNguon("p", "m")).toBe("Model ngoài · p/m");
    expect(huyHieuNguon("p", "m", { nhaCungCap: "p", model: "m", tokenVao: 100, tokenRa: 50, chiPhiUocUsd: 0.1234 })).toBe("Model ngoài · p/m · ~150 token · ~$0.12");
    expect(huyHieuNguon("p", "m", { nhaCungCap: "p", model: "m", tokenVao: 1, tokenRa: null, chiPhiUocUsd: 0.001 })).toBe("Model ngoài · p/m · ~$0.0010");
  });
  it("khoaDongY: đổi hội thoại hoặc model ⇒ khoá khác", () => {
    expect(khoaDongY("c1", "ngoai:p:a")).not.toBe(khoaDongY("c1", "ngoai:p:b"));
    expect(khoaDongY("c1", "ngoai:p:a")).not.toBe(khoaDongY("c2", "ngoai:p:a"));
    expect(khoaDongY("c1", "ngoai:p:a")).toBe(khoaDongY("c1", "ngoai:p:a"));
  });
});

describe("bộ render không tin cậy", () => {
  it("★ lamSachVanBanNgoai bỏ RLO/LRE/zero-width/BOM", () => {
    expect(lamSachVanBanNgoai("a‮b​c⁦d﻿e")).toBe("abcde");
  });
  it("★ liên kết thành «nhãn (miền)», không còn nút `a`; ảnh không thành thẻ; HTML thô là chữ", () => {
    const cay = lamKhongTinCay(phanTichMarkdown("Xem [tài liệu](https://evil.example.com/p?q=1) và ![x](http://t.example/p.png) <img src=x onerror=1> `c`"));
    const json = JSON.stringify(cay);
    expect(json).not.toContain('"t":"a"');
    expect(json).toContain("(evil.example.com)");
    expect(json).not.toContain("https://evil.example.com/p");
    expect(json).toContain("<img src=x onerror=1>");
  });
  it("liên kết lồng trong danh sách/bảng cũng bị gỡ", () => {
    const cay = lamKhongTinCay(phanTichMarkdown("- [a](https://h1.example)\n\n| x |\n|---|\n| [b](https://h2.example) |"));
    const json = JSON.stringify(cay);
    expect(json).not.toContain('"t":"a"');
    expect(json).toContain("(h1.example)");
    expect(json).toContain("(h2.example)");
  });
  it("liên kết không có miền (mailto:) ⇒ chỉ còn nhãn", () => {
    expect(JSON.stringify(lamKhongTinCay(phanTichMarkdown("[mail](mailto:a@b.c)")))).not.toContain('"t":"a"');
  });
});
