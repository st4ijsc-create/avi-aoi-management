// T12b — kế hoạch toast theo báo cáo thật của abortStops: không success khi sent = 0 hoặc còn cờ "chưa biết"/nợ.
import { describe, expect, it } from "vitest";
import { keHoachToastAbort, lyDoChuaBiet, type AbortStopsBaoCao } from "./abortStopToasts";

const RONG: AbortStopsBaoCao = { sent: [], failed: [], pending: [], unverified: [], untakenBranch: [], notPinned: [], notNeeded: [] };
const bc = (x: Partial<AbortStopsBaoCao>): AbortStopsBaoCao => ({ ...RONG, ...x });

describe("keHoachToastAbort", () => {
  it("sent > 0, sạch ⇒ thành công", () => {
    expect(keHoachToastAbort(bc({ sent: ["a"] }))).toEqual({ dau: "thanhCong", lyDo: [] });
  });
  it("★ sent = 0, báo cáo rỗng ⇒ 'không STOP nào đi' (KHÔNG success)", () => {
    expect(keHoachToastAbort(bc({})).dau).toBe("khongStopNaoDi");
  });
  it("sent = 0 nhưng còn điều khác để nói (failed / pending / unverified / untakenBranch / notPinned / notNeeded) ⇒ không toast đầu (toast riêng lo), KHÔNG success", () => {
    for (const k of ["failed", "pending", "unverified", "untakenBranch", "notPinned", "notNeeded"] as const) {
      expect(keHoachToastAbort(bc({ [k]: ["x"] })).dau, k).toBe("khong");
    }
  });
  it.each([
    ["khongDocDuoc", { khongDocDuoc: true }],
    ["quetChuaXong", { quetChuaXong: true }],
    ["nhapQuet", { nhapQuet: true }],
    ["khongBen", { khongBen: ["abort:3"] }],
    ["conNo", { phanLoai: { s1: { lop: "no" } } }],
  ] as const)("★ cờ %s ⇒ 'chưa biết', kể cả khi sent > 0", (khoa, extra) => {
    const k0 = keHoachToastAbort(bc({ ...(extra as Partial<AbortStopsBaoCao>) }));
    expect(k0).toEqual({ dau: "chuaBiet", lyDo: [khoa] });
    expect(keHoachToastAbort(bc({ sent: ["a", "b"], ...(extra as Partial<AbortStopsBaoCao>) })).dau).toBe("chuaBiet");
  });
  it("phanLoai không có lop 'no' (daGiao / xong / coTheDaRa) ⇒ không phải cờ nợ; khongBen rỗng ⇒ không phải cờ", () => {
    expect(lyDoChuaBiet(bc({ phanLoai: { a: { lop: "daGiao" }, b: { lop: "xong" }, c: { lop: "coTheDaRa" } }, khongBen: [] }))).toEqual([]);
  });
  it("nhiều cờ ⇒ liệt kê đủ theo thứ tự", () => {
    expect(lyDoChuaBiet(bc({ khongDocDuoc: true, quetChuaXong: true, nhapQuet: true, khongBen: ["x"], phanLoai: { s: { lop: "no" } } }))).toEqual([
      "khongDocDuoc", "quetChuaXong", "nhapQuet", "khongBen", "conNo",
    ]);
  });
});
