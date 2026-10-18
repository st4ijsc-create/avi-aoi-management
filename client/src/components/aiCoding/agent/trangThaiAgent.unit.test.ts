/**
 * Đợt 1 · T5 — bộ giảm sự kiện agent (THUẦN): chuỗi `SuKienAgent` ⇒ trạng thái dòng thời gian.
 * Viết TRƯỚC mã (`trangThaiAgent.ts`).
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import {
  TRANG_THAI_RONG,
  batDauGui,
  giamNhieu,
  giamSuKien,
  layDiffTuDeXuat,
  thamSoChinh,
  type TrangThaiAgent,
} from "./trangThaiAgent";

function chay(es: SuKienAgent[], tu: TrangThaiAgent = batDauGui("sửa lỗi X", "sua")): TrangThaiAgent {
  return giamNhieu(tu, es);
}

describe("trangThaiAgent — giamSuKien", () => {
  it("batDauGui: câu hỏi là mục đầu, đang chạy, chưa có runId", () => {
    const s = batDauGui("hỏi gì đó", "sua");
    expect(s.dongThoiGian).toEqual([{ kieu: "cau-hoi", noiDung: "hỏi gì đó" }]);
    expect(s.dangChay).toBe(true);
    expect(s.runId).toBeNull();
    expect(s.soSuKien).toBe(0);
  });

  it("bat-dau đặt runId + chế độ; đếm số sự kiện đã nhận (cho ?tu=n)", () => {
    const s = chay([{ loai: "bat-dau", runId: "r1", cheDo: "tu-dong" }]);
    expect(s.runId).toBe("r1");
    expect(s.cheDo).toBe("tu-dong");
    expect(s.soSuKien).toBe(1);
  });

  it("chu/nghi liên tiếp được GỘP; một tool chen giữa ⇒ khối chữ mới", () => {
    const s = chay([
      { loai: "nghi", noiDung: "để " },
      { loai: "nghi", noiDung: "xem" },
      { loai: "chu", noiDung: "Tôi " },
      { loai: "chu", noiDung: "đọc tệp." },
      { loai: "goi-tool", goi: { id: "c1", ten: "read_file", thamSo: { path: "a.ts" } }, luot: 1 },
      { loai: "chu", noiDung: "Xong." },
    ]);
    const kieu = s.dongThoiGian.map((m) => m.kieu);
    expect(kieu).toEqual(["cau-hoi", "nghi", "chu", "tool", "chu"]);
    expect(s.dongThoiGian[1]).toMatchObject({ noiDung: "để xem" });
    expect(s.dongThoiGian[2]).toMatchObject({ noiDung: "Tôi đọc tệp." });
    expect(s.dongThoiGian[4]).toMatchObject({ noiDung: "Xong." });
  });

  it("ket-qua-tool gắn vào đúng dòng tool theo id", () => {
    const s = chay([
      { loai: "goi-tool", goi: { id: "c1", ten: "grep", thamSo: { pattern: "foo" } }, luot: 1 },
      { loai: "goi-tool", goi: { id: "c2", ten: "read_file", thamSo: { path: "b.ts" } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c2", ten: "read_file", ok: false, tomTat: "không tồn tại", ma: "NOT_FOUND" },
      { loai: "ket-qua-tool", id: "c1", ten: "grep", ok: true, tomTat: "3 kết quả" },
    ]);
    const tools = s.dongThoiGian.filter((m) => m.kieu === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ id: "c1", ketQua: { ok: true, tomTat: "3 kết quả" } });
    expect(tools[1]).toMatchObject({ id: "c2", ketQua: { ok: false, ma: "NOT_FOUND" } });
  });

  it("ke-hoach THAY danh sách (không nối); dang-cho-model đặt rồi bị xoá khi model chạy", () => {
    let s = chay([
      { loai: "ke-hoach", viec: [{ noiDung: "a", trangThai: "cho" }] },
      { loai: "ke-hoach", viec: [{ noiDung: "a", trangThai: "xong" }, { noiDung: "b", trangThai: "dang-lam" }] },
      { loai: "dang-cho-model", phiaTruoc: 2 },
    ]);
    expect(s.keHoach).toEqual([{ noiDung: "a", trangThai: "xong" }, { noiDung: "b", trangThai: "dang-lam" }]);
    expect(s.phiaTruoc).toBe(2);
    s = giamSuKien(s, { loai: "chu", noiDung: "x" });
    expect(s.phiaTruoc).toBeNull();
  });

  it("can-duyet ⇒ choDuyet; bi-bac lưu lý do; da-duyet đổi trạng thái thẻ", () => {
    let s = chay([
      { loai: "goi-tool", goi: { id: "c1", ten: "delete_file", thamSo: { path: "x.ts" } }, luot: 2 },
      { loai: "can-duyet", id: "c1", deXuat: { ten: "delete_file", thamSo: { path: "x.ts" }, pendingActionId: 41 } },
    ]);
    expect(s.choDuyet).toBe(true);
    const the = s.dongThoiGian.find((m) => m.kieu === "duyet");
    expect(the).toMatchObject({ id: "c1", trangThai: "cho" });
    s = giamSuKien(s, { loai: "bi-bac", id: "c1", lyDo: "đừng xoá" });
    expect(s.choDuyet).toBe(false);
    expect(s.dongThoiGian.find((m) => m.kieu === "duyet")).toMatchObject({ trangThai: "bi-bac", lyDo: "đừng xoá" });
    s = giamSuKien(s, { loai: "can-duyet", id: "c2", deXuat: { ten: "run_command", thamSo: { command: "npm test" } } });
    s = giamSuKien(s, { loai: "da-duyet", id: "c2" });
    expect(s.dongThoiGian.filter((m) => m.kieu === "duyet").map((m) => (m as { trangThai: string }).trangThai)).toEqual(["bi-bac", "da-duyet"]);
  });

  it("tệp đã đổi = tool GHI có kết quả ok (path/from/to) ∪ hienThi.thayDoi; tool ghi THẤT BẠI không tính", () => {
    const s = chay([
      { loai: "checkpoint", checkpointId: "k1", tep: ["a.ts"] },
      { loai: "goi-tool", goi: { id: "c1", ten: "edit_file", thamSo: { path: "a.ts", edits: [] } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c1", ten: "edit_file", ok: true, tomTat: "ok" },
      { loai: "goi-tool", goi: { id: "c2", ten: "write_file", thamSo: { path: "b.ts", content: "" } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c2", ten: "write_file", ok: false, tomTat: "bị bác", ma: "BI_BAC" },
      { loai: "goi-tool", goi: { id: "c3", ten: "rename_file", thamSo: { from: "c.ts", to: "d.ts" } }, luot: 2 },
      { loai: "ket-qua-tool", id: "c3", ten: "rename_file", ok: true, tomTat: "ok" },
      { loai: "goi-tool", goi: { id: "c4", ten: "read_file", thamSo: { path: "e.ts" } }, luot: 2 },
      { loai: "ket-qua-tool", id: "c4", ten: "read_file", ok: true, tomTat: "ok" },
      { loai: "goi-tool", goi: { id: "c5", ten: "run_command", thamSo: { command: "npm run fmt" } }, luot: 3 },
      {
        loai: "ket-qua-tool", id: "c5", ten: "run_command", ok: true, tomTat: "ok",
        hienThi: { thayDoi: [{ duong: "f.ts", loai: "sua" }, { duong: "a.ts", loai: "sua" }] },
      },
    ]);
    expect(s.tepDaDoi).toEqual(["a.ts", "d.ts", "f.ts"]);
    expect(s.checkpoints).toEqual([{ checkpointId: "k1", tep: ["a.ts"] }]);
  });

  it("usage cộng dồn vào/ra, giữ ctx % mới nhất", () => {
    const s = chay([
      { loai: "usage", vao: 100, ra: 20, nghi: 5, ctxPhanTram: 10 },
      { loai: "usage", vao: 50, ra: 10, ctxPhanTram: 14 },
    ]);
    expect(s.usage).toEqual({ vao: 150, ra: 30, nghi: 5, ctxPhanTram: 14 });
  });

  it("loi thêm mục lỗi; xong dừng + ghi lý do, xoá chờ-duyệt/chờ-model", () => {
    const s = chay([
      { loai: "can-duyet", id: "c1", deXuat: { ten: "run_command", thamSo: { command: "x" } } },
      { loai: "dang-cho-model", phiaTruoc: 1 },
      { loai: "loi", ma: "MODEL_LOI", thongDiep: "hỏng" },
      { loai: "xong", lyDo: "loi-model", tomTat: "dừng vì lỗi" },
    ]);
    expect(s.dangChay).toBe(false);
    expect(s.choDuyet).toBe(false);
    expect(s.phiaTruoc).toBeNull();
    expect(s.ketThuc).toEqual({ lyDo: "loi-model", tomTat: "dừng vì lỗi" });
    expect(s.dongThoiGian.some((m) => m.kieu === "loi")).toBe(true);
    // thẻ duyệt còn treo lúc xong ⇒ hết hiệu lực (không còn nút bấm được)
    expect(s.dongThoiGian.find((m) => m.kieu === "duyet")).toMatchObject({ trangThai: "het-hieu-luc" });
  });

  it("sự kiện lạ không làm hỏng trạng thái, vẫn được đếm (giữ khớp chỉ số ?tu=n)", () => {
    const s0 = chay([]);
    const s = giamSuKien(s0, { loai: "khong-biet" } as unknown as SuKienAgent);
    expect(s.dongThoiGian).toEqual(s0.dongThoiGian);
    expect(s.soSuKien).toBe(1);
  });

  it("phát lại từ đầu (nối lại sau tải trang) dựng lại cùng dòng thời gian", () => {
    const es: SuKienAgent[] = [
      { loai: "bat-dau", runId: "r9", cheDo: "sua" },
      { loai: "chu", noiDung: "a" },
      { loai: "goi-tool", goi: { id: "c1", ten: "list_dir", thamSo: { path: "." } }, luot: 1 },
    ];
    const a = giamNhieu(TRANG_THAI_RONG, es);
    const b = giamNhieu(TRANG_THAI_RONG, es);
    expect(a).toEqual(b);
    expect(a.dangChay).toBe(true);
    expect(a.runId).toBe("r9");
  });
});

describe("thamSoChinh — đối số chính hiển thị trên dòng tool", () => {
  it.each([
    ["read_file", { path: "src/a.ts", start_line: 3 }, "src/a.ts"],
    ["run_command", { command: "npm test" }, "npm test"],
    ["rename_file", { from: "a.ts", to: "b.ts" }, "a.ts → b.ts"],
    ["grep", { pattern: "foo", path: "src" }, "foo · src"],
    ["find_files", { pattern: "*.ts" }, "*.ts"],
    ["todo_write", { todos: [1, 2, 3] }, "3"],
    ["la", {}, ""],
  ])("%s", (ten, ts, mong) => {
    expect(thamSoChinh(ten, ts as Record<string, unknown>)).toBe(mong);
  });
});

describe("layDiffTuDeXuat — đề xuất ghi ⇒ args cho TheDuyetDiff (dung nạp nhiều hình dạng)", () => {
  it("xemTruoc.pendingAction.args (khuôn PendingActionDTO)", () => {
    const d = layDiffTuDeXuat({
      ten: "edit_file",
      thamSo: { path: "a.ts" },
      xemTruoc: {
        pendingAction: {
          tool: "apply_diff",
          args: { path: "a.ts", original: "x", modified: "y" },
          expiresAt: "2026-10-17T10:00:00.000Z",
          preview: { warnings: ["w"] },
        },
      },
    });
    expect(d).toEqual({ args: { path: "a.ts", original: "x", modified: "y" }, expiresAt: "2026-10-17T10:00:00.000Z", warnings: ["w"] });
  });
  it("xemTruoc phẳng {path, original, modified}", () => {
    const d = layDiffTuDeXuat({ ten: "write_file", thamSo: { path: "n.ts" }, xemTruoc: { path: "n.ts", original: "", modified: "z" } });
    expect(d?.args).toEqual({ path: "n.ts", original: "", modified: "z" });
    expect(typeof d?.expiresAt).toBe("string");
  });
  it("không có diff (delete/run_command) ⇒ null", () => {
    expect(layDiffTuDeXuat({ ten: "delete_file", thamSo: { path: "a.ts" } })).toBeNull();
    expect(layDiffTuDeXuat({ ten: "run_command", thamSo: { command: "ls" }, xemTruoc: { argv: ["ls"] } })).toBeNull();
  });
});

describe("Đợt 2 — đề xuất nhớ + dòng tool của 4 tool mới", () => {
  it("de-xuat-nho ⇒ thẻ 'nho' trạng thái cho (nội dung + phạm vi); xong KHÔNG làm nó hết hiệu lực", async () => {
    const { capNhatDeXuatNho } = await import("./trangThaiAgent");
    let s = chay([
      { loai: "bat-dau", runId: "r1", cheDo: "hoi" },
      { loai: "de-xuat-nho", id: "nho-1", note: "Dùng pnpm.", scope: "project" },
      { loai: "xong", lyDo: "hoan-thanh" },
    ]);
    const m = s.dongThoiGian.find((x) => x.kieu === "nho");
    expect(m).toEqual({ kieu: "nho", id: "nho-1", note: "Dùng pnpm.", scope: "project", trangThai: "cho" });
    s = capNhatDeXuatNho(s, "nho-1", { trangThai: "da-nho" });
    expect(s.dongThoiGian.find((x) => x.kieu === "nho")).toEqual(expect.objectContaining({ trangThai: "da-nho" }));
    // cập nhật id lạ ⇒ không đổi
    expect(capNhatDeXuatNho(s, "khac", { trangThai: "da-bo" })).toEqual(s);
  });

  it("phát lại cùng sự kiện (nối lại ?tu=0) ⇒ cùng một thẻ, không nhân đôi", () => {
    const es: SuKienAgent[] = [
      { loai: "bat-dau", runId: "r1", cheDo: "hoi" },
      { loai: "de-xuat-nho", id: "nho-1", note: "a", scope: "user" },
      { loai: "de-xuat-nho", id: "nho-1", note: "a", scope: "user" },
    ];
    expect(chay(es).dongThoiGian.filter((x) => x.kieu === "nho")).toHaveLength(1);
  });

  it("thamSoChinh: tên ký hiệu / câu tìm / ghi chú", () => {
    expect(thamSoChinh("find_symbol", { name: "cong", kind: "function" })).toBe("cong · function");
    expect(thamSoChinh("find_symbol", { name: "cong" })).toBe("cong");
    expect(thamSoChinh("search_code", { query: "retry logic" })).toBe("retry logic");
    expect(thamSoChinh("search_docs", { query: "MC protocol", corpus: "vendor" })).toBe("MC protocol · vendor");
    expect(thamSoChinh("remember", { note: "Dùng pnpm." })).toBe("Dùng pnpm.");
  });
});

describe("(2026-10-17) nội dung đáng ngờ — cảnh báo + hạ tự trị (không dừng)", () => {
  it("canh-bao-du-lieu / ha-tu-tri ⇒ mục 'canh-bao' trên dòng thời gian; lượt VẪN chạy; daHaTuTri chỉ bật bởi ha-tu-tri", () => {
    const s = chay([
      { loai: "bat-dau", runId: "r1", cheDo: "tu-dong" },
      { loai: "canh-bao-du-lieu", id: "c1", ten: "read_file", nguon: "docs/x.md", mau: ["ignore_instructions"] },
    ]);
    expect(s.dangChay).toBe(true);
    expect(s.daHaTuTri).toBe(false);
    expect(s.dongThoiGian.at(-1)).toEqual({ kieu: "canh-bao", loaiCanhBao: "du-lieu", nguon: "docs/x.md", mau: ["ignore_instructions"] });
    const s2 = giamSuKien(s, { loai: "ha-tu-tri", lyDo: "noi-dung-dang-ngo", nguon: "docs/x.md", mau: ["ignore_instructions"] });
    expect(s2.daHaTuTri).toBe(true);
    expect(s2.dongThoiGian.at(-1)).toMatchObject({ kieu: "canh-bao", loaiCanhBao: "ha-tu-tri", nguon: "docs/x.md" });
    expect(s2.dangChay).toBe(true);
  });
});
