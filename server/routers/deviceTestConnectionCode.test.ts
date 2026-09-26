/**
 * F14 — `deviceAdapter.testConnection` phải trả MÃ máy-đọc-được kèm chi tiết kỹ thuật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO CHỖ NÀY CẦN LƯỚI RIÊNG
 * ══════════════════════════════════════════════════════════════════════════════════
 * Thủ tục này KHÔNG ném khi dò thất bại — nó trả **200 OK** kèm `{ ok: false, error }`.
 * Nghĩa là toàn bộ bộ máy i18n lỗi của dự án không chạm được vào nó:
 *   • `onError` phía client không chạy (đây là `onSuccess`);
 *   • `errorFormatter` không gắn `appCode` (không có gì được ném);
 *   • `mapTrpcError` không bao giờ nhìn thấy chuỗi ấy.
 *
 * Đo được trước bản vá (`DeviceOnboardingWizard.tsx`): CÙNG MỘT Ô hiện câu ĐÃ DỊCH khi
 * lỗi đi đường `onError`, và hiện *"ModbusDriver: not connected"* khi đi đường
 * `onSuccess` — mà đường sau mới là đường hay xảy ra ở nhà máy.
 *
 * ── VÌ SAO GIỮ CẢ CHUỖI THÔ ──────────────────────────────────────────────────────
 * Hai hạng người đọc cùng một ô: người vận hành cần *"không tới được thiết bị Modbus,
 * kiểm nguồn/dây/IP"*; kỹ sư cần *"ECONNREFUSED 10.0.0.5:502"*. Dịch chuỗi kỹ thuật
 * thành câu chung chung là đổi thông tin hữu ích lấy ngôn ngữ — đúng lớp lỗi F4 đã ghi
 * sổ ("mất thông tin hành-động-được"). Nên trả CẢ HAI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTER = readFileSync(join(HERE, "deviceAdapterRouter.ts"), "utf8");
const LOCALES = resolve(HERE, "..", "..", "client", "src", "i18n", "locales");
const doc = (lg: string) => JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8"));

/** Enum giao thức mà thủ tục thật sự chấp nhận — nguồn sự thật là chính router. */
function giaoThucHopLe(): string[] {
  const m = ROUTER.match(/const protocolEnum = z\.enum\(\[([^\]]+)\]\)/);
  if (!m) throw new Error("không đọc được protocolEnum — router đã đổi hình dạng");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("F14 — testConnection trả mã máy-đọc-được", () => {
  it("cầu chì: đọc được enum giao thức từ router", () => {
    expect(giaoThucHopLe().length).toBeGreaterThan(3);
  });

  it("★★★ CẢ HAI nhánh hỏng đều trả `errorCode` — không nhánh nào chỉ có chuỗi thô", () => {
    // Hai nhánh: `createDriver` ném (giao thức không có driver) và `connect` ném
    // (không tới được). Bỏ sót một nhánh thì đúng nhánh đó vẫn nói tiếng Anh, và không
    // ai phát hiện vì nhánh kia đã "có vẻ đúng".
    expect(ROUTER).toMatch(/errorCode: "DEVICE_PROTOCOL_UNSUPPORTED" as const/);
    expect(ROUTER).toMatch(/errorCode: "DEVICE_UNREACHABLE" as const/);
    const soNhanhTraOk = (ROUTER.match(/ok: false,\s*\r?\n\s*latencyMs/g) ?? []).length;
    expect(soNhanhTraOk, "số nhánh trả ok:false trong testConnection").toBe(2);
  });

  it("★★★ chuỗi KỸ THUẬT phải được GIỮ — bản vá không được nuốt thông tin", () => {
    // Đối trọng cho ca trên. Không có ca này, cách "sửa" rẻ nhất là xoá luôn `error` —
    // cổng i18n sẽ xanh hơn, và kỹ sư mất hẳn thứ duy nhất chỉ ra hỏng ở đâu.
    const traVe = (ROUTER.match(/error: err instanceof Error \? err\.message : String\(err\)/g) ?? []).length;
    expect(traVe, "hai nhánh hỏng đều phải kèm chi tiết kỹ thuật").toBe(2);
  });

  it("★★★ hai mã mới phải có câu ở CẢ BA locale", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const e = doc(lg).errors;
      for (const ma of ["DEVICE_UNREACHABLE", "DEVICE_PROTOCOL_UNSUPPORTED"]) {
        expect(typeof e[ma], `${lg}.errors.${ma}`).toBe("string");
        expect(e[ma], `${lg}.errors.${ma} phải nội suy {{entity}}`).toContain("{{entity}}");
      }
    }
  });

  it("★★★ MỌI giá trị của `protocolEnum` phải có trong `errors.entity.*` đủ ba locale", () => {
    // `errorParams: { entity: protocol }` truyền thẳng giá trị enum. Thiếu khoá ⇒ người
    // dùng đọc *"Không kết nối được tới thiết bị mitsubishi-mc"* — chuỗi định danh thô
    // lọt ra giữa một câu đã dịch. Cùng lớp lỗi mà `entityDictionaryCoverage` bắt cho
    // đường `appError`, nhưng đường NÀY nằm ngoài tầm nói của cổng đó (không ai ném cả).
    const thieu: string[] = [];
    for (const lg of ["vi", "en", "zh"]) {
      const ent = doc(lg).errors.entity ?? {};
      for (const p of giaoThucHopLe()) if (ent[p] === undefined) thieu.push(`${lg}:${p}`);
    }
    expect(thieu).toEqual([]);
  });
});
