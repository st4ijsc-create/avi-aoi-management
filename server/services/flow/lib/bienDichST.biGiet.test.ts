/**
 * ★ Đợt 9 (2026-10-22) — lượt biên dịch BỊ GIẾT: `137` sớm = trình biên dịch NỔ bộ nhớ (không phải hết giờ).
 * Gốc (kiem-dinh, docs/superpowers/audits/2026-10-22-rusty-oom.md): RuSTy 1.0.7 `plc -c` phình bộ nhớ vô hạn khi nhãn CASE
 * trùng giữa các nhánh viết dạng DANH SÁCH; `plc --ir` báo ngay "duplicate case value in switch" (rc 1). Nay `-c` bị giết sớm ⇒
 * chạy THÊM `--ir` để trả chẩn đoán thật cho model sửa (đường bình thường không tốn thêm).
 * Tệp mẫu: `__fixtures__/rusty-no-bo-nho-ud3.st` (mã THẬT 27B sinh trong A/B /v1, st-ud3#1) + ca tối thiểu 11 dòng của kiem-dinh.
 *
 * ĐỘT BIẾN PHẢI BẮT: mọi 137 lại báo "quá 60 s" · bỏ dự phòng --ir (lại khong-kiem-duoc) · --ir chạy cả ở đường bình thường ·
 * 124 không còn là het-gio · mã thoát thường bị coi là bị giết · lỗi bộ dựng LLVM không thành chẩn đoán.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoiBienDichST, bienDichST, chanDoanTuIr, coAnhST, coDockerST, phanLoaiBiGiet, soLuotDockerRunST } from "./bienDichST";

describe("phanLoaiBiGiet", () => {
  it("137 SỚM ⇒ ha-tang (trình biên dịch sập, nói rõ ms + bộ nhớ); 137 gần trần / 124 / bị giết bởi bộ hẹn giờ ⇒ het-gio", () => {
    const sap = phanLoaiBiGiet("137", false, 908);
    expect(sap?.loai).toBe("ha-tang");
    expect(sap?.thongDiep).toMatch(/908 ms/);
    expect(sap?.thongDiep).toMatch(/bộ nhớ/);
    expect(phanLoaiBiGiet("137", false, 59_000)?.loai).toBe("het-gio");
    expect(phanLoaiBiGiet("124", false, 3_000)?.loai).toBe("het-gio");
    expect(phanLoaiBiGiet("", true, 80_000)?.loai).toBe("het-gio");
  });
  it("mã thoát bình thường (0, 1, rỗng) ⇒ null (không phải bị giết)", () => {
    for (const rc of ["0", "1", ""]) expect(phanLoaiBiGiet(rc, false, 500)).toBeNull();
  });
});

describe("chanDoanTuIr (thuần)", () => {
  it("lỗi bộ dựng LLVM ⇒ MỘT chẩn đoán không dòng, có 'duplicate case value' + ghi chú nhãn CASE", () => {
    const log = "Error: Builder error: /tmp/.tmpF5K0vt/10-ma.st.ll:19:5: error: duplicate case value in switch\n    i16 1, label %case1\n";
    const d = chanDoanTuIr("1", log);
    expect(d).toHaveLength(1);
    expect(d![0]).toMatchObject({ dong: null, mucDo: "error" });
    expect(d![0].thongDiep).toMatch(/duplicate case value in switch/);
    expect(d![0].thongDiep).toMatch(/nhãn CASE/);
  });
  it("rc 0 / rỗng / không có chữ error ⇒ null (giữ phân loại hạ tầng)", () => {
    expect(chanDoanTuIr("0", "error: x")).toBeNull();
    expect(chanDoanTuIr("", "error: x")).toBeNull();
    expect(chanDoanTuIr("137", "Killed")).toBeNull();
  });
  it("cờ docker: đường bình thường GIỐNG bản cũ (không CHE_DO); --ir thêm CHE_DO=ir + trần riêng", () => {
    const thuong = coDockerST("t", "C:\\v");
    expect(thuong.join(" ")).not.toContain("CHE_DO");
    expect(thuong).toContain("CT=60");
    const ir = coDockerST("t", "C:\\v", undefined, { cheDo: "ir", giay: 15 });
    expect(ir).toContain("CHE_DO=ir");
    expect(ir).toContain("CT=15");
  });
});

const CO_ANH = await coAnhST().catch(() => false);
const MIN = "PROGRAM P\nVAR\n    S : INT;\n    X : INT;\nEND_VAR\n    CASE S OF\n        1, 2:\n            X := 1;\n        1, 2:\n            X := 2;\n    END_CASE\nEND_PROGRAM\n";
describe.skipIf(!CO_ANH)("bienDichST × RuSTy THẬT — mã làm `-c` nổ bộ nhớ ⇒ dự phòng `--ir` trả chẩn đoán thật", () => {
  for (const [ten, ma] of [
    ["ca tối thiểu 11 dòng (kiem-dinh)", MIN],
    ["mã thật 27B (ud3)", fs.readFileSync(path.join(__dirname, "__fixtures__", "rusty-no-bo-nho-ud3.st"), "utf8")],
  ] as const) {
    it(`★ ${ten}: ok:false + chẩn đoán "duplicate case value" (KHÔNG ném, KHÔNG 'quá 60 s')`, async () => {
      const t0 = Date.now();
      const truoc = soLuotDockerRunST();
      const kq = await bienDichST(ma);
      expect(soLuotDockerRunST() - truoc).toBe(2); // -c (bị giết) + --ir
      expect(kq.ok).toBe(false);
      expect(kq.chanDoan.map((d) => d.thongDiep).join("\n")).toMatch(/duplicate case value/);
      expect(Date.now() - t0).toBeLessThan(45_000);
    }, 90_000);
  }
  it("đường bình thường (mã đúng) KHÔNG chạy --ir: một lượt docker, sạch", async () => {
    const truoc = soLuotDockerRunST();
    const kq = await bienDichST("PROGRAM P\nVAR x : INT; END_VAR\n  x := 1;\nEND_PROGRAM\n");
    expect(kq.ok).toBe(true);
    expect(soLuotDockerRunST() - truoc).toBe(1); // KHÔNG có lượt --ir
  }, 60_000);
});
if (!CO_ANH) console.warn("[bienDichST.biGiet] bỏ qua ca docker: thiếu ảnh st-rusty");
void LoiBienDichST;
