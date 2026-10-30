/**
 * C1 fix round 1 (M2) — mã lỗi của sổ lệnh (khi máy chủ che errorText) ⇒ chữ đã dịch, đọc locale THẬT vi / en / zh.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { khoaMaLoi, MA_LOI_DU_PHONG_CLIENT } from "./commandAuditMa";

const GOC = join(__dirname, "..", "..", "..");
const LOCALE = Object.fromEntries(
  (["vi", "en", "zh"] as const).map((l) => [l, JSON.parse(readFileSync(join(GOC, "client", "src", "i18n", "locales", `${l}.json`), "utf8"))]),
);
const lay = (o: unknown, khoa: string): unknown => khoa.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const coKhoa = (l: string) => (k: string) => typeof lay(LOCALE[l], k) === "string";

describe("khoaMaLoi — mã lỗi bị che ⇒ khoá chữ", () => {
  it("mã cổng đã có chữ ⇒ scada.lenh.cong.<MÃ> (kể cả TIMEOUT — gợi ý an toàn cùng câu với hộp thoại lệnh)", () => {
    expect(khoaMaLoi("TIMEOUT", coKhoa("vi"))).toBe("scada.lenh.cong.TIMEOUT");
    expect(khoaMaLoi("TAG_NOT_WRITABLE", coKhoa("vi"))).toBe("scada.lenh.cong.TAG_NOT_WRITABLE");
  });
  it("mã DỰ PHÒNG của máy chủ ⇒ commandAudit.maLoi.<MÃ>; mã lạ ⇒ null (bên gọi hiện mã thô)", () => {
    expect(khoaMaLoi("DRIVER_WRITE_FAILED", coKhoa("vi"))).toBe("commandAudit.maLoi.DRIVER_WRITE_FAILED");
    expect(khoaMaLoi("EDGE_REPORTED", coKhoa("en"))).toBe("commandAudit.maLoi.EDGE_REPORTED");
    expect(khoaMaLoi("MA_LA_XYZ", coKhoa("vi"))).toBeNull();
  });
  it("mọi mã dự phòng có chữ ở cả vi / en / zh, và danh sách client TRÙNG danh sách máy chủ (MA_LOI_DU_PHONG)", () => {
    for (const l of ["vi", "en", "zh"]) for (const ma of MA_LOI_DU_PHONG_CLIENT) {
      const k = khoaMaLoi(ma, coKhoa(l));
      expect(k, `${l} ${ma}`).not.toBeNull();
      expect(typeof lay(LOCALE[l], k as string), `${l} ${k}`).toBe("string");
    }
    const src = readFileSync(join(GOC, "server", "routers", "_chiTietKyThuat.ts"), "utf8");
    const m = /export const MA_LOI_DU_PHONG = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    const may = [...(m as RegExpExecArray)[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    expect([...MA_LOI_DU_PHONG_CLIENT].sort()).toEqual(may.sort());
  });
});
