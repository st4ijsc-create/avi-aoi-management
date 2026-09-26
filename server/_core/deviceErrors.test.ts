/**
 * F3 Pha 1 — lỗi thiết bị mang mã máy-đọc-được, và MỌI entity phải có trong từ điển.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐƯỜNG NÀY NẰM NGOÀI TẦM NÓI CỦA `entityDictionaryCoverage`
 * ══════════════════════════════════════════════════════════════════════════════════
 * Cổng đó quét `appError(..., { entity })` — tức chỉ những chỗ dùng `appError()`. Ở đây
 * `entity` đi qua `appParams` của một LỚP LỖI THƯỜNG, nên nó vô hình với cổng ấy.
 * Thiếu khoá ⇒ `localizeParams()` trả chuỗi thô ⇒ người dùng đọc *"Không kết nối được tới
 * thiết bị mitsubishi"* — định danh lọt ra giữa một câu đã dịch. Không lỗi, không cảnh
 * báo, tsc xanh. Chỉ chỗ này thấy được.
 *
 * ── VÌ SAO CÓ BẢNG ÁNH XẠ ROBOT ─────────────────────────────────────────────────
 * `RobotVendor` và `OtProtocol` là hai tập tên KHÁC nhau nhưng TRÙNG MỘT PHẦN — và trùng
 * một phần mới là chỗ nguy hiểm: `RobotVendor` có `"mitsubishi"` (robot), `OtProtocol` có
 * `"mitsubishi-mc"` (PLC MELSEC). Dùng thẳng giá trị vendor làm khoá thì hoặc tra trúng
 * khoá KHÁC NGHĨA, hoặc không có khoá nào.
 * ⇒ Cùng luật đã rút ba lần trong đợt này: **trước khi gom hai tập trông giống nhau, hỏi
 *   xem chúng có NGHĨA giống nhau không.**
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeviceUnreachableError,
  DeviceProtocolUnsupportedError,
  FeatureDisabledError,
  KHOA_THUC_THE_ROBOT,
} from "./deviceErrors";
import { readAppErrorMeta } from "./appError";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const LOCALES = resolve(SERVER, "..", "client", "src", "i18n", "locales");
const doc = (lg: string) => JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8"));

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walkTs(f));
    else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(f);
  }
  return out;
}

/** Mọi entity dạng chuỗi hằng truyền cho hai lớp lỗi thiết bị, quét toàn `server/**`. */
function entityDaDung(): string[] {
  const out: string[] = [];
  for (const f of walkTs(SERVER)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/new Device(?:Unreachable|ProtocolUnsupported)Error\(\s*"([^"]+)"/g)) {
      out.push(m[1]);
    }
  }
  return out;
}

describe("F3 Pha 1 — lỗi thiết bị mang mã", () => {
  it("cầu chì: phép quét phải THẤY entity, không thì nó đang canh tập rỗng", () => {
    // Thiếu bước này, khẳng định dưới đây đúng một cách vô nghĩa (∀ trên tập rỗng) —
    // đúng lớp lỗi glob-rỗng đã trả giá ở Pha 4.
    expect(new Set(entityDaDung()).size).toBeGreaterThan(10);
  });

  it("★★★ `readAppErrorMeta` đọc được CẢ `appCode` LẪN `appParams` qua `cause`", () => {
    // Đây là toàn bộ cơ chế: tRPC bọc lỗi thường thành `TRPCError({ cause })`, và hàm này
    // đọc `cause`. Hỏng chỗ này thì mã không bao giờ tới client và không gì báo cho ai.
    const boc = { cause: new DeviceUnreachableError("modbus") };
    expect(readAppErrorMeta(boc)).toEqual({
      appCode: "DEVICE_UNREACHABLE",
      appParams: { entity: "modbus" },
    });
    const boc2 = { cause: new DeviceProtocolUnsupportedError("s7", "P2") };
    expect(readAppErrorMeta(boc2)?.appCode).toBe("DEVICE_PROTOCOL_UNSUPPORTED");
  });

  it("★★★ ĐỐI TRỌNG: lỗi thường KHÔNG được sinh ra mã — nếu không, mọi thứ đều 'có mã'", () => {
    expect(readAppErrorMeta({ cause: new Error("bất kỳ") })).toBeNull();
  });

  it("chi tiết kỹ thuật vẫn nằm trong `message` (làm fallback khi thiếu khoá i18n)", () => {
    expect(new DeviceUnreachableError("opcua", "ECONNREFUSED 10.0.0.5:4840").message)
      .toContain("ECONNREFUSED 10.0.0.5:4840");
  });

  it("★★★ MỌI entity truyền cho hai lớp này phải có khoá ở CẢ BA locale", () => {
    const vi = doc("vi").errors.entity ?? {};
    const en = doc("en").errors.entity ?? {};
    const zh = doc("zh").errors.entity ?? {};
    const thieu = [...new Set(entityDaDung())]
      .filter((e) => vi[e] === undefined || en[e] === undefined || zh[e] === undefined)
      .sort();
    if (thieu.length) console.error("[F3] entity KHÔNG có trong từ điển:", thieu);
    expect(thieu).toEqual([]);
  });

  it("★★★ bảng ánh xạ robot phải phủ ĐỦ `RobotVendor`, và trỏ tới khoá CÓ THẬT", () => {
    // Thiếu một hãng ⇒ nhánh `?? this.vendor` trả định danh thô ra màn hình.
    const src = readFileSync(join(SERVER, "services", "robot", "robotDriver.ts"), "utf8");
    const m = src.match(/export type RobotVendor\s*=\s*([^;]+);/);
    expect(m, "không đọc được RobotVendor — file đã đổi hình dạng").not.toBeNull();
    const vendors = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(vendors.length).toBeGreaterThan(4);

    const vi = doc("vi").errors.entity ?? {};
    const thieuAnhXa = vendors.filter((v) => KHOA_THUC_THE_ROBOT[v] === undefined);
    expect(thieuAnhXa, "hãng robot chưa có trong bảng ánh xạ").toEqual([]);
    const troTrat = vendors.filter((v) => vi[KHOA_THUC_THE_ROBOT[v]] === undefined);
    expect(troTrat, "bảng ánh xạ trỏ tới khoá KHÔNG tồn tại").toEqual([]);
  });

  it("★★★ `FeatureDisabledError` KHÔNG được nuốt tên biến môi trường", () => {
    // Chuỗi gốc mang HAI thông tin cho HAI người: "tính năng chưa bật" (người vận hành xử
    // được bằng cách báo quản trị) và "đặt SECS_GEM_ENABLED=true" (câu lệnh cho quản trị).
    // `appCode`+`feature` chở phần đầu; `message` chở phần sau và LÀ fallback.
    // Bỏ phần sau đi là một bước LÙI cho quản trị — đúng thứ luật hai điều kiện cấm.
    const e = new FeatureDisabledError("secsGem", "set SECS_GEM_ENABLED=true to enable");
    expect(e.message).toContain("SECS_GEM_ENABLED=true");
    expect(readAppErrorMeta({ cause: e })).toEqual({
      appCode: "FEATURE_DISABLED",
      appParams: { feature: "secsGem" },
    });
  });

  it("★★★ mọi `feature` truyền cho `FeatureDisabledError` phải có khoá ở CẢ BA locale", () => {
    // Cùng lỗ hổng với `entity`: cổng `appErrorParamsCoverage` chỉ quét `appError(...)`,
    // nên `feature` đi qua `appParams` của lớp lỗi thường là vô hình với nó.
    const dung: string[] = [];
    for (const f of walkTs(SERVER)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new FeatureDisabledError\(\s*"([^"]+)"/g)) dung.push(m[1]);
    }
    expect(dung.length, "cầu chì: phải THẤY lời gọi, không thì canh tập rỗng").toBeGreaterThan(2);
    const vi = doc("vi").errors.feature ?? {};
    const en = doc("en").errors.feature ?? {};
    const zh = doc("zh").errors.feature ?? {};
    const thieu = [...new Set(dung)]
      .filter((k) => vi[k] === undefined || en[k] === undefined || zh[k] === undefined)
      .sort();
    if (thieu.length) console.error("[F3] feature KHÔNG có trong từ điển:", thieu);
    expect(thieu).toEqual([]);
  });

  it("★★★ `mitsubishi` (robot) và `mitsubishi-mc` (PLC) phải là HAI khoá KHÁC nhau", () => {
    // Ca này giữ đúng cái bẫy đã suýt rơi vào: hai tập tên trùng MỘT PHẦN.
    expect(KHOA_THUC_THE_ROBOT["mitsubishi"]).toBe("mitsubishiRobot");
    const vi = doc("vi").errors.entity;
    expect(vi["mitsubishiRobot"]).not.toBe(vi["mitsubishi-mc"]);
  });
});
