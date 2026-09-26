/**
 * Task 10 (2026-08-24) — LƯỚI đường ZIP package phải đi qua `authenticateMachine`,
 * KHÔNG còn tự phân giải máy bằng `getMachineByCode`/`getMachineByApiKey` trực
 * tiếp (xem .superpowers/sdd/2026-08-24-aoi-pha0-va-no-co-san/task-10-report.md).
 *
 * Lỗ đã vá: `authenticateMachine` (server/services/machineAuthService.ts) từ chối
 * xác thực bằng machineCode-trần theo mặc định (`MACHINE_CODE_ONLY_ALLOWED=deny`)
 * — biết mã máy KHÔNG đủ, nó là ĐỊNH DANH chưa bao giờ là bí mật. Nhưng bốn chỗ
 * (presign/commit/reportQueueMetrics ở `aoiPackageRouter.ts` + PUT
 * /api/aoi/upload/:packageId ở `server/_core/index.ts`) tự gọi thẳng
 * `getMachineByCode`/`getMachineByApiKey`, bỏ qua hoàn toàn cổng ấy ⇒ cờ mua
 * được 0 trên toàn đường ZIP.
 *
 * §1 — `aoiPackageRouter.ts` KHÔNG còn `getMachineByCode(`/`getMachineByApiKey(`.
 * §2 — `aoiPackageRouter.ts` CÓ gọi `authenticateMachine(` (≥3 lần: presign/
 *      commit/reportQueueMetrics).
 * §3 — vùng tuyến PUT /api/aoi/upload/:packageId trong `server/_core/index.ts`
 *      KHÔNG còn `getMachineByCode(`/`getMachineByApiKey(`, và CÓ gọi
 *      `authenticateMachine(`.
 * §4 — chống đọc-file-rỗng: độ dài nguồn đọc được phải > 1000 ký tự (một
 *      đường dẫn hỏng im lặng đọc ra chuỗi rỗng và mọi `not.toMatch` ở §1/§3
 *      sẽ XANH GIẢ — "0 vi phạm" vì không có gì để đọc, không phải vì không
 *      có vi phạm).
 * §5 — ĐỐI CHỨNG phạm vi: `server/_core/index.ts` vẫn CÒN `getMachineByCode(`
 *      ở NGOÀI vùng tuyến upload (các tuyến khác không thuộc Task 10) — chứng
 *      minh §3 đang canh đúng một VÙNG, không phải trùng khớp "cả file đã sạch".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AOI_PACKAGE_ROUTER_PATH = join(__dirname, "aoiPackageRouter.ts");
const AOI_PACKAGE_ROUTER_SOURCE = readFileSync(AOI_PACKAGE_ROUTER_PATH, "utf-8");

const CORE_INDEX_PATH = join(__dirname, "..", "_core", "index.ts");
const CORE_INDEX_SOURCE = readFileSync(CORE_INDEX_PATH, "utf-8");

/**
 * Cắt ra đúng vùng thân của tuyến `app.put("/api/aoi/upload/:packageId", …)` —
 * từ điểm khai báo tuyến tới điểm khai báo tuyến TIẾP THEO (`app.<method>(` ở
 * đầu dòng thụt 2 khoảng trắng, đúng thụt lề mọi tuyến trong file này dùng).
 * Trả về "" nếu không tìm thấy mốc mở đầu — gọi nơi dùng phải TỰ kiểm rỗng
 * (đừng để một marker trôi biến thành một chuỗi rỗng XANH GIẢ).
 */
function vungTuyenUploadZip(source: string): string {
  const MOC_MO = 'app.put("/api/aoi/upload/:packageId"';
  const batDau = source.indexOf(MOC_MO);
  if (batDau === -1) return "";
  const phanConLai = source.slice(batDau + MOC_MO.length);
  const mocTuyenKeTiep = /\n {2}app\.(get|put|post|delete|patch)\(/;
  const khop = phanConLai.match(mocTuyenKeTiep);
  const ketThuc = khop ? batDau + MOC_MO.length + (khop.index ?? phanConLai.length) : source.length;
  return source.slice(batDau, ketThuc);
}

const VUNG_UPLOAD = vungTuyenUploadZip(CORE_INDEX_SOURCE);

describe("aoiPackageRouter × _core/index.ts — đường ZIP machine auth đi qua authenticateMachine (Task 10)", () => {
  it("§4 chống đọc-file-rỗng — cả hai nguồn đọc được phải dài hơn 1000 ký tự", () => {
    expect(AOI_PACKAGE_ROUTER_SOURCE.length).toBeGreaterThan(1000);
    expect(CORE_INDEX_SOURCE.length).toBeGreaterThan(1000);
  });

  it("§4b cầu chì — vùng tuyến upload phải cắt được và không quá nhỏ/quá lớn (marker còn đúng chỗ)", () => {
    expect(
      VUNG_UPLOAD.length,
      "không tìm thấy `app.put(\"/api/aoi/upload/:packageId\"` trong _core/index.ts — marker đã đổi?",
    ).toBeGreaterThan(500);
    // Vùng cắt phải NHỎ HƠN HẲN toàn file — nếu nó bằng gần hết file nghĩa là
    // mốc tuyến TIẾP THEO không khớp và §3/§5 đang canh nhầm phạm vi (cả file).
    expect(VUNG_UPLOAD.length).toBeLessThan(CORE_INDEX_SOURCE.length / 2);
  });

  it("§1 aoiPackageRouter.ts KHÔNG còn gọi getMachineByCode(/getMachineByApiKey( trực tiếp", () => {
    expect(AOI_PACKAGE_ROUTER_SOURCE).not.toMatch(/getMachineByCode\(/);
    expect(AOI_PACKAGE_ROUTER_SOURCE).not.toMatch(/getMachineByApiKey\(/);
  });

  it("§2 aoiPackageRouter.ts CÓ gọi authenticateMachine( — ít nhất 3 lần (presign/commit/reportQueueMetrics)", () => {
    const soLan = (AOI_PACKAGE_ROUTER_SOURCE.match(/authenticateMachine\(/g) ?? []).length;
    expect(soLan).toBeGreaterThanOrEqual(3);
    expect(AOI_PACKAGE_ROUTER_SOURCE).toMatch(
      /import\s*\{\s*authenticateMachine\s*\}\s*from\s*"\.\.\/services\/machineAuthService"/,
    );
    // `machineHeaderKey` phải TÁI DÙNG từ machineApiRouters.ts, không chép lại
    // logic đọc header (hai bản chép sẽ lệch hành vi theo thời gian).
    expect(AOI_PACKAGE_ROUTER_SOURCE).toMatch(
      /import\s*\{\s*machineHeaderKey\s*\}\s*from\s*"\.\/machineApiRouters"/,
    );
  });

  it("§3 vùng tuyến PUT /api/aoi/upload KHÔNG còn getMachineByCode(/getMachineByApiKey( trực tiếp, CÓ gọi authenticateMachine(", () => {
    expect(VUNG_UPLOAD).not.toMatch(/getMachineByCode\(/);
    expect(VUNG_UPLOAD).not.toMatch(/getMachineByApiKey\(/);
    expect(VUNG_UPLOAD).toMatch(/authenticateMachine\(/);
  });

  it("§5 ĐỐI CHỨNG phạm vi — _core/index.ts vẫn còn getMachineByCode( NGOÀI vùng tuyến upload (tuyến khác, ngoài phạm vi Task 10)", () => {
    const ngoaiVung = CORE_INDEX_SOURCE.replace(VUNG_UPLOAD, "");
    expect(
      ngoaiVung,
      "0 lượt getMachineByCode( ngoài vùng upload ⇒ §3 có thể đang xanh vì CẢ FILE đã sạch, " +
        "không phải vì phép cắt vùng đúng phạm vi — cần đối chứng dương này để phân biệt hai khả năng",
    ).toMatch(/getMachineByCode\(/);
  });
});
