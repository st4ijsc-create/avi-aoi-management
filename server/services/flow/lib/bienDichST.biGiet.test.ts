/**
 * ★ Đợt 9 (2026-10-22) — lượt biên dịch BỊ GIẾT: `137` sớm = trình biên dịch NỔ bộ nhớ (không phải hết giờ).
 * Tệp mẫu `__fixtures__/rusty-no-bo-nho-ud3.st` = mã THẬT 27B sinh trong A/B /v1 (st-ud3-bang-tai-tuan-tu#1, ghép prelude
 * bởi `ghepMaST`): RuSTy 1.0.7 bị giết sau ~1 s kể cả với --memory 6g. Ca docker bỏ qua có thông báo nếu ảnh vắng.
 *
 * ĐỘT BIẾN PHẢI BẮT: mọi 137 lại báo "quá 60 s" · 124 không còn là het-gio · mã thoát thường bị coi là bị giết.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoiBienDichST, bienDichST, coAnhST, phanLoaiBiGiet } from "./bienDichST";

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

const CO_ANH = await coAnhST().catch(() => false);
describe.skipIf(!CO_ANH)("bienDichST × RuSTy THẬT — mã làm trình biên dịch nổ bộ nhớ", () => {
  it("★ ném ha-tang trong vài giây (KHÔNG báo 'quá 60 s')", async () => {
    const ma = fs.readFileSync(path.join(__dirname, "__fixtures__", "rusty-no-bo-nho-ud3.st"), "utf8");
    const t0 = Date.now();
    const e = await bienDichST(ma).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(LoiBienDichST);
    expect((e as LoiBienDichST).loai).toBe("ha-tang");
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);
});
if (!CO_ANH) console.warn("[bienDichST.biGiet] bỏ qua ca docker: thiếu ảnh st-rusty");
