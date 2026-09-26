/**
 * ★★★ **HÌNH DẠNG ĐƯỜNG DẪN + CHỐNG TRAVERSAL** — lưới THUẦN, không chạm CSDL.
 *
 * ⚠ Vì sao tách khỏi lưới `.db.test.ts`: hai câu hỏi khác nhau. *"`%2e%2e%2f` có bị chặn không"* là
 * một tính chất của **chuỗi**, và trộn nó vào một lưới cần Postgres nghĩa là nó im lặng biến mất ở
 * mọi máy không có CSDL — đúng lớp lỗi "glob rỗng ⇒ vitest im lặng, cổng khai xanh" đã ghi trong sổ.
 */
import { describe, it, expect } from "vitest";
import {
  MA_DUONG_DAN_XAU,
  chuanHoaDuongDanTai,
  hinhDangCuaDuongDan,
  type HinhDangDuongDan,
} from "./_uyQuyenAnh";

/** Chuẩn hoá rồi phân loại — đúng chuỗi mà cửa thật đi qua. */
function loai(p: string): HinhDangDuongDan | { kieu: "CHAN"; lyDo: string } {
  const ch = chuanHoaDuongDanTai(p);
  if (!ch.ok) return { kieu: "CHAN", lyDo: ch.lyDo };
  return hinhDangCuaDuongDan(ch.doan);
}

describe("uỷ quyền ảnh — §1 CHỐNG TRAVERSAL", () => {
  // ⚠⚠ Ô quan trọng nhất của cả tệp: `%2e%2e%2f` là `../` SAU một lượt giải mã. Một bộ lọc soi
  //    chuỗi THÔ cho nó đi qua, rồi `express.static` giải mã và mở đúng cái cửa vừa "được canh".
  it("§1.1 — `..` ở mọi dạng mã hoá đều bị CHẶN", () => {
    for (const p of [
      "/uploads/../.env",
      "/uploads/inspections/../../.env",
      "/uploads/%2e%2e/.env",
      "/uploads/%2E%2E%2F.env",
      "/uploads/inspections/12/%2e%2e%2f%2e%2e%2fserver/index.ts",
      "..",
      "/uploads/a/./b.png",
    ]) {
      const ch = chuanHoaDuongDanTai(p);
      expect(ch.ok, `phải CHẶN: ${p}`).toBe(false);
      if (!ch.ok) expect(ch.ma).toBe(MA_DUONG_DAN_XAU);
    }
  });

  it("§1.2 — đường TUYỆT ĐỐI, dấu `\\`, NUL, ký tự điều khiển, `%` lạc đều bị CHẶN", () => {
    for (const p of [
      "C:/Windows/win.ini",
      "/uploads/C:/Windows/win.ini",
      "/uploads/inspections\\..\\..\\.env",
      "/uploads/a%00.png",
      "/uploads/a\u0000.png",
      "/uploads/a\nb.png",
      "/uploads/100%.jpg", // `%` lạc ⇒ không giải mã được ⇒ KHÔNG ĐOÁN, từ chối
      "",
      "/uploads/",
      "/uploads//inspections/1/a.png",
    ]) {
      expect(chuanHoaDuongDanTai(p).ok, `phải CHẶN: ${JSON.stringify(p)}`).toBe(false);
    }
  });

  it("§1.3 — chiều DƯƠNG: đường dẫn thật (có dấu cách, chữ có dấu) KHÔNG bị chặn oan", () => {
    // ⚠ Chống vá quá tay. `factory-alert-releases/v 1.0.3/…` là một đường dẫn CÓ THẬT trên đĩa.
    const ch = chuanHoaDuongDanTai("/uploads/factory-alert-releases/v%201.0.3/App-v%201.0.3.apk");
    expect(ch.ok).toBe(true);
    if (ch.ok) expect(ch.doan).toEqual(["factory-alert-releases", "v 1.0.3", "App-v 1.0.3.apk"]);

    const ch2 = chuanHoaDuongDanTai("/uploads/inspections/87323/BP001-VX3jmwJ-.jpg");
    expect(ch2.ok).toBe(true);
    if (ch2.ok) expect(ch2.doan).toEqual(["inspections", "87323", "BP001-VX3jmwJ-.jpg"]);

    // Nhận cả dạng ĐÃ bị express cắt tiền tố (`app.use("/uploads", …)` ⇒ `req.path`).
    const ch3 = chuanHoaDuongDanTai("/inspections/87323/BP001-VX3jmwJ-.jpg");
    expect(ch3.ok).toBe(true);
    if (ch3.ok) expect(ch3.doan).toEqual(["inspections", "87323", "BP001-VX3jmwJ-.jpg"]);
  });

  // ⚠ Ô CHỐNG "chặt hơn thành hỏng": giải mã HAI lần sẽ từ chối một tên tệp hợp lệ mà
  //   `express.static` (giải mã đúng MỘT lần) phục vụ được.
  it("§1.4 — `%252e%252e` KHÔNG bị chặn: nó là một tên tệp, không phải một lượt thoát", () => {
    const ch = chuanHoaDuongDanTai("/uploads/inspections/12/%252e%252e.png");
    expect(ch.ok).toBe(true);
    if (ch.ok) expect(ch.doan[2]).toBe("%2e%2e.png");
  });
});

describe("uỷ quyền ảnh — §2 HÌNH DẠNG (mọi thư mục CÓ THẬT ở cả hai gốc)", () => {
  it("§2.1 — sáu hình dạng mang dữ liệu tenant được nhận đúng khoá phân giải", () => {
    expect(loai("/uploads/inspections/87323/a.jpg")).toEqual({
      kieu: "theoLanKiem",
      inspectionId: 87323,
    });
    expect(loai("/uploads/aoi-cache/AOI-INS-1771426567845/R101_check.png")).toEqual({
      kieu: "theoGoi",
      packageId: "AOI-INS-1771426567845",
    });
    expect(loai("/uploads/measurement-points/30/AREA1-crop-E2Qm7OMZ.png")).toEqual({
      kieu: "theoDiemDo",
      pointId: 30,
    });
    expect(loai("/uploads/machines/243/2d-1784565811768.jpg")).toEqual({
      kieu: "theoMay",
      machineId: 243,
    });
    expect(loai("/uploads/product-models/5/ref-1773672478570.png")).toEqual({
      kieu: "theoSanPham",
      productModelId: 5,
    });
    // Đường ghi CŨ (6 đoạn) — 30 tệp có thật trên đĩa.
    expect(loai("/uploads/aoi/AVI-GB300-01/2026/04/12/INS-20260412-00001.zip")).toEqual({
      kieu: "theoMaMay",
      machineCode: "AVI-GB300-01",
    });
  });

  // ★ Khuôn do `phamViGhiMay.khoaLuuTruGoi` sinh — phân biệt với khuôn CŨ **chỉ bằng ĐỘ SÂU**.
  it("§2.2 — đường ghi MỚI (10 đoạn) ra `theoMaNhaMay`, và `_no-corp` KHÔNG làm lệch vị trí", () => {
    expect(loai("/uploads/aoi/SIM/SIM-FAC/WS1/L1/AVI-01/2026/08/18/INS-1.zip")).toEqual({
      kieu: "theoMaNhaMay",
      factoryCodeDoan: "SIM-FAC",
    });
    // `corporateCode` NULL ⇒ đoạn `_no-corp` TƯỜNG MINH ⇒ độ sâu là HẰNG SỐ ⇒ đoạn nhà máy vẫn ở
    // đúng vị trí 2. Đây chính là tính chất làm phép so tiền tố O(1) phát biểu được.
    expect(loai("/uploads/aoi/_no-corp/AUDIT_FAC_01/WS/L/M/2026/08/18/INS-2.zip")).toEqual({
      kieu: "theoMaNhaMay",
      factoryCodeDoan: "AUDIT_FAC_01",
    });
  });

  it("§2.3 — nhóm TÁC TẠO được khai TƯỜNG MINH (không rơi vào nhánh mặc định)", () => {
    for (const p of [
      "/uploads/models/heads/aoi-defect-head/v1.0.0/head.json",
      "/uploads/models/machine-243-1784565729799.glb",
      "/uploads/mqtt-releases/10-factory-alert-v1.0.9.apk",
      "/uploads/factory-alert-releases/FactoryAlertSystem-v1.0.0.apk",
      "/uploads/gguf-models/mmproj-model-f16.gguf",
      "/uploads/tmp/x.bin",
      "/uploads/temp/tmp_1783064447781_px6n6peur3h.jpg", // ⚠ `temp` ≠ `tmp`, brief chỉ khai `tmp`
      "/uploads/test-temp/TEST-1770439359228.zip",
      "/uploads/aoi-test-standalone.html",
    ]) {
      expect(loai(p), p).toMatchObject({ kieu: "tacTao" });
    }
  });

  // ⚠ HAI thư mục brief BỎ SÓT, và cả hai MANG dữ liệu tenant.
  it("§2.4 — `report-artifacts/` và `exports/` là TENANT có tuyến riêng ⇒ nhánh CÓ TÊN", () => {
    expect(loai("/uploads/report-artifacts/2026/08/03b54aa6.csv")).toMatchObject({
      kieu: "tuyenRieng",
      nhom: "report-artifacts",
    });
    expect(loai("/uploads/exports/factories_1783733944155.xlsx")).toMatchObject({
      kieu: "tuyenRieng",
      nhom: "exports",
    });
  });

  it("§2.5 — hình dạng LẠ ⇒ `la` (fail-closed), kèm lý do đọc được", () => {
    for (const p of [
      "/uploads/khong-ton-tai/x.png",
      "/uploads/inspections/abc/x.png", // khoá không phải số
      "/uploads/inspections/0/x.png", // 0 không phải id hợp lệ
      "/uploads/inspections/12/sub/x.png", // ĐÚNG 3 đoạn, không phải "≥ 3"
      "/uploads/inspections/12", // thiếu tệp
      "/uploads/aoi/A/B/C.zip", // độ sâu 4: không phải khuôn nào
      "/uploads/aoi/A/2026/08/18/19/x.zip", // độ sâu 7
      "/uploads/machines/12/a/b.png",
      "/uploads/index.html", // tệp gốc KHÔNG có trong danh sách
    ]) {
      expect(loai(p), p).toMatchObject({ kieu: "la" });
    }
  });

  // ⚠⚠ ĐỘT BIẾN TĨNH: một thư mục MỚI xuất hiện dưới `uploads/` phải rơi vào `la`, **không** được
  //    thừa hưởng lời phán "chắc là tác tạo". Ô này là thứ làm `THU_MUC_TAC_TAO` phải liệt kê tay.
  it("§2.6 — thư mục MỚI (chưa ai khai) rơi vào `la`, không vào `tacTao`", () => {
    expect(loai("/uploads/exports-v2/a.csv")).toMatchObject({ kieu: "la" });
    expect(loai("/uploads/backups/dump.sql")).toMatchObject({ kieu: "la" });
  });
});
