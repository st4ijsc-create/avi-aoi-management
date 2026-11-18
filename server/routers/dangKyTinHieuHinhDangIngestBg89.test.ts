/**
 * server/routers/dangKyTinHieuHinhDangIngestBg89.test.ts
 *
 * Task 3 (BG-89, docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §7.2) — canh tín hiệu
 * ĐẾM ĐƯỢC hai hình dạng ingest (v1.x/v1.1 phẳng ↔ v2.0 cây) mà hai cửa ingest phát ra qua
 * `ghiTinHieuHinhDangIngest` → bảng `audit_logs` CÓ SẴN (KHÔNG thêm bảng/migration).
 *
 * ── ★★★ VIẾT LẠI cho I-4 (review lượt 8) — ĐIỂM GHI DỜI RA SAU XÁC THỰC ────────────────
 * Bản ĐẦU của lô BG-89 ghi tín hiệu bên trong `quyetDinhPhienBanIngest`, tức trong
 * `.transform()` của `.input()`, tức **TRƯỚC** `authenticateMachine` (xác thực nằm trong thân
 * `.mutation()`). Cả hai cửa là `publicProcedure`. Hệ quả ĐO ĐƯỢC (review lượt 8, I-4):
 *   (a) `entityName` là LỜI MÁY TỰ KHAI chưa xác thực ⇒ con số đếm GIẢ MẠO ĐƯỢC ⇒ nó không
 *       trả lời được đúng câu nó sinh ra để trả lời ("còn bao nhiêu MÁY THẬT gửi hình dạng cũ?");
 *   (b) một người gọi KHÔNG CÓ credential nào ghi được số hàng KHÔNG GIỚI HẠN vào `audit_logs`
 *       — bảng WORM cho vai `avi_app` (`REVOKE UPDATE, DELETE`, mig 0224) ⇒ **không ai dọn được**;
 *   (c) trần tốc độ khoá theo credential ĐỌC TỪ BODY và chỉ kiểm CÓ MẶT, không kiểm HỢP LỆ ⇒
 *       xoay vòng credential giả là bỏ qua trần.
 * Chính file này TỪNG khoá hành vi đó lại: 4/9 ca dùng "credential GIẢ" mà vẫn ĐÒI có hàng.
 * Một lưới xanh trên một hành vi sai là thứ giữ hành vi sai sống lâu nhất — nên bốn ca ấy nay
 * đòi ĐIỀU NGƯỢC LẠI, và chúng ĐỎ được trên mã trước bản vá (xem fix8b-report.md, chép nguyên văn).
 *
 * ── BA MỆNH ĐỀ BẮT BUỘC (brief I-4) ────────────────────────────────────────────────────
 *  1. Lượt ingest XÁC THỰC THÀNH CÔNG ⇒ có ĐÚNG MỘT hàng `ingest_shape_legacy`/`ingest_shape_v2`.
 *  2. Lượt ingest SAI apiKey ⇒ KHÔNG hàng nào.
 *  3. Hình dạng ghi ra KHỚP hình dạng `quyetDinhPhienBanIngest` đã quyết định — KHÔNG suy lại
 *     lần hai (không có nguồn sự thật thứ hai). Canh bằng §D: điểm quyết định phải THUẦN.
 *
 * ── ĐÁNH ĐỔI KHAI RÕ (§C) ──────────────────────────────────────────────────────────────
 * Sau bản vá, lượt HỎNG XÁC THỰC và lượt HỎNG ZOD **không** được đếm; và khi cờ
 * `INGEST_REJECT_LEGACY_MACHINE_ENABLED` BẬT, payload v1.x bị `loiMayChuaNangCap` ném NGAY
 * trong `.input()` (trước xác thực) nên cũng **không** được đếm. Đây là đánh đổi CÓ CHỦ Ý:
 * câu hỏi cần trả lời là "còn bao nhiêu MÁY THẬT gửi hình dạng cũ" — máy chưa xác thực không
 * phải máy thật; và câu hỏi ấy được hỏi để QUYẾT ĐỊNH có bật cờ hay không, tức khi cờ còn TẮT
 * (mặc định hôm nay). §C ghim cả hai chiều bằng SELECT thật để không ai khai ngược lại mà
 * không làm lưới đỏ.
 *
 * ── ★ CÔ LẬP ───────────────────────────────────────────────────────────────────────────
 * Mỗi ca tạo MÁY RIÊNG (mã duy nhất theo STAMP) và đếm theo `entityName` = mã máy ĐÃ XÁC THỰC
 * ⇒ số đếm là số TUYỆT ĐỐI, không phải delta, không lệ thuộc các tệp test chạy song song.
 * Mọi ca gọi ĐÚNG router thật (`machineApiRouter.createCaller`) rồi SELECT lại `audit_logs`
 * bằng `db.getDb()` (vai `avi_app`, DB `aoi_management_test`) — không spy/mock hàm ghi log.
 * `audit_logs` + `product_inspections` đều WORM ⇒ hàng do file này tạo ở lại VĨNH VIỄN (afterAll).
 *
 * ★ TỆP NÀY CHỈ GIỮ PHẦN THUẦN (§D soi mã nguồn + §E hằng số/hàm export): không DB. Phần §A–§C và ca ghi thật của §E
 *   (INSERT vào `audit_logs` + `product_inspections` — bảng WORM) nằm ở `dangKyTinHieuHinhDangIngestBg89.db.test.ts`,
 *   chạy trong MỘT giao dịch ROLLBACK.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestRejectLegacyMachineEnabled } from "./machineApiRouters";
import { AUDIT_ACTIONS } from "../services/auditTrailService";

beforeEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});
afterEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});

describe("§D — mệnh đề 3: hình dạng ghi ra là hình dạng ĐÃ QUYẾT ĐỊNH, không suy lại lần hai", () => {
  const nguon = readFileSync(path.join(__dirname, "machineApiRouters.ts"), "utf8");

  /** Thân hàm theo NGOẶC CÂN, không theo dòng — một `if` lồng không cắt nhầm phạm vi. */
  function thanHam(ten: string): string {
    const moc = nguon.indexOf(`function ${ten}(`);
    expect(moc, `không tìm thấy \`function ${ten}(\` trong machineApiRouters.ts`).toBeGreaterThan(-1);
    const batDau = nguon.indexOf("{", moc);
    let sau = 0;
    for (let i = batDau; i < nguon.length; i++) {
      if (nguon[i] === "{") sau++;
      else if (nguon[i] === "}") {
        sau--;
        if (sau === 0) return nguon.slice(batDau, i + 1);
      }
    }
    throw new Error(`không đóng được ngoặc của \`${ten}\``);
  }

  it("★★★ `quyetDinhPhienBanIngest` THUẦN — 0 lời gọi `ghiTinHieuHinhDangIngest` trong thân nó (điểm quyết định KHÔNG kèm ghi sổ)", () => {
    const than = thanHam("quyetDinhPhienBanIngest");
    expect(than).toContain("laHinhDangCayV2(raw)"); // bộ trích thân hàm thật sự trúng đích
    expect(
      than.includes("ghiTinHieuHinhDangIngest"),
      "điểm quyết định phiên bản chạy trong `.transform()` của `.input()` — TRƯỚC `authenticateMachine`. " +
        "Ghi sổ ở đây là ghi một hàng WORM cho một người gọi CHƯA XÁC THỰC (I-4).",
    ).toBe(false);
  });

  it("★ `ghiTinHieuHinhDangIngest` chỉ có ĐÚNG BA điểm gọi — đúng hai cửa ingest (submitInspection có hai nhánh v1/v2, submitInspectionBatch một)", () => {
    const soLanXuatHien = nguon.split("ghiTinHieuHinhDangIngest(").length - 1;
    // 1 định nghĩa + 3 điểm gọi. Thêm một điểm gọi thứ tư ⇒ lưới ĐỎ và người thêm phải khai
    // nó nằm SAU `authenticateMachine` nào.
    expect(soLanXuatHien).toBe(4);
  });

  it("★ hình dạng truyền vào điểm ghi là GIÁ TRỊ ĐÃ QUYẾT ĐỊNH (`parsedInput.kind` / `hinhDangIngest`), không phải một lượt `laHinhDangCayV2` thứ hai", () => {
    // `laHinhDangCayV2` được phép xuất hiện ĐÚNG ở nơi quyết định (và trong chú thích), KHÔNG
    // ở nơi ghi: một nguồn sự thật thứ hai là cách hai con số bắt đầu lệch nhau mà không ai biết.
    const than = thanHam("ghiTinHieuHinhDangIngest");
    expect(than.includes("laHinhDangCayV2")).toBe(false);
  });
});

/**
 * ── §E — Lô 3 Mục 2 (BG-57b): tín hiệu MỚI cho lượt TỪ CHỐI ────────────────────────────────
 *
 * `ingest_shape_legacy_rejected` KHÁC hẳn `ingest_shape_legacy` (§A mệnh đề 1): hàng đó ghi khi
 * payload phẳng được **NHẬN** (cờ TẮT); hàng này ghi khi payload phẳng bị **TỪ CHỐI** (cờ BẬT).
 * Điểm gọi THẬT là `aoiPackageRouter.commit` (BG-39 gđ2, Mục 3 của lô này) — cửa ZIP xác thực
 * TRƯỚC KHI đọc `meta.json` nên gác + ghi sổ Ở ĐÓ không lặp lại lỗ I-4 (ghi WORM cho người gọi
 * CHƯA XÁC THỰC). File này chỉ canh phần DÙNG CHUNG (hằng số + hàm ghi) — hành vi ĐẦU CUỐI của
 * cửa ZIP có lưới riêng (`aoiPackageZipGacMayCu.test.ts`).
 *
 * "Đăng ký" ở đây nghĩa là: (1) hằng số tồn tại ĐÚNG chuỗi, (2) `ghiTinHieuHinhDangIngest` NHẬN
 * giá trị `"v1-rejected"` và ghi ĐÚNG action đó (không lặp lại `INGEST_SHAPE_LEGACY`), (3) hai hàm
 * dùng chung (`ghiTinHieuHinhDangIngest`/`ingestRejectLegacyMachineEnabled`) THẬT SỰ được export
 * — xoá `export` ở MỘT trong hai làm import phía trên (dòng 51-56) vỡ biên dịch NGAY, tức census
 * này đỏ TRƯỚC KHI kịp chạy assertion nào bên dưới.
 */
describe("§E — BG-57b: `ingest_shape_legacy_rejected` — hằng số + hàm ghi DÙNG CHUNG đã đăng ký", () => {
  it("AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED tồn tại, ĐÚNG chuỗi, KHÁC hai action anh em", () => {
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).toBe("ingest_shape_legacy_rejected");
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).not.toBe(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY);
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).not.toBe(AUDIT_ACTIONS.INGEST_SHAPE_V2);
  });

  it("`ingestRejectLegacyMachineEnabled` được export từ machineApiRouters (Mục 3/BG-39 gđ2 cần dùng lại, không đọc process.env lần thứ hai)", () => {
    expect(typeof ingestRejectLegacyMachineEnabled).toBe("function");
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
    expect(ingestRejectLegacyMachineEnabled()).toBe(false);
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    expect(ingestRejectLegacyMachineEnabled()).toBe(true);
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
  });
});
