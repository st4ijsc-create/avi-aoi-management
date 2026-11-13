// T12b — kế hoạch toast theo báo cáo thật của abortStops: không success khi sent = 0 hoặc còn cờ "chưa biết"/nợ.
import { describe, expect, it } from "vitest";
import { keHoachToastAbort, lyDoChuaBiet, soGiaoThat, type AbortStopsBaoCao } from "./abortStopToasts";

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

describe("keHoachToastAbort — khớp điều kiện `conGi` của server (scada-master 13/11)", () => {
  it("★ sent = [s1], failed = [s2] ⇒ KHÔNG thành công", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], failed: ["s2"] })).dau).toBe("khong");
  });
  it("★ sent = [s1], notPinned = [x] ⇒ KHÔNG thành công (notPinned nằm trong conGi của server)", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], notPinned: ["x"] })).dau).toBe("khong");
  });
  it.each(["pending", "unverified", "untakenBranch"] as const)("★ sent > 0 và %s không rỗng ⇒ KHÔNG thành công", (k) => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], [k]: ["x"] })).dau).toBe("khong");
  });
  it("★ sent = [s1] mà phanLoai s1 = coTheDaRa ⇒ 'chưa biết' với lý do coTheDaRa, KHÔNG thành công", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], phanLoai: { s1: { lop: "coTheDaRa" } } }))).toEqual({ dau: "chuaBiet", lyDo: ["coTheDaRa"] });
  });
  it("coTheDaRa của một id KHÔNG nằm trong sent không tính (phân loại bước khác)", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], phanLoai: { s2: { lop: "coTheDaRa" } } })).dau).toBe("thanhCong");
  });
  it("sent = [s1] với phanLoai s1 = daGiao / xong ⇒ thành công", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], phanLoai: { s1: { lop: "daGiao" } } })).dau).toBe("thanhCong");
    expect(keHoachToastAbort(bc({ sent: ["s1"], phanLoai: { s1: { lop: "xong" } } })).dau).toBe("thanhCong");
  });
});

// Ma trận R-1 của T9 (foeEngine.ts:6983-7020, hàm settle `r.ok ? sent : failed`): kết cục giao cuối của MỘT STOP rơi vào mảng nào ⇒ toast nào.
describe("ma trận R-1 — kết cục giao cuối của một STOP ⇒ mảng abortStops ⇒ kế hoạch toast", () => {
  const MA_TRAN: ReadonlyArray<[string, Partial<AbortStopsBaoCao>, "thanhCong" | "khong"]> = [
    ["ok (acked*) ⇒ sent", { sent: ["s1"] }, "thanhCong"],
    // simulated ⇒ sent (dispatcher trả ok:true, status "simulated"); abortStops CHƯA có trường phân biệt mô phỏng ⇒ chữ chỉ được nói
    // "giao cho bộ điều phối (máy chưa xác nhận)" — kiểm ở test chữ của trang (không bao giờ "máy đã nhận / đã ra").
    ["simulated ⇒ sent (chữ trung tính)", { sent: ["s1"] }, "thanhCong"],
    ["DRIVER_WRITE_FAILED ⇒ failed (thiết bị CÓ THỂ đã được ghi, vẫn KHÔNG thành công)", { sent: ["s0"], failed: ["s1"] }, "khong"],
    ["ADAPTER_OWNED_BY_EDGE / ADAPTER_OFFLINE / lỗi chuẩn bị / ném ⇒ failed", { sent: ["s0"], failed: ["s1", "s2"] }, "khong"],
    ["không trả lời trước hạn ⇒ pending", { sent: ["s0"], pending: ["s1"] }, "khong"],
    ["ghim chưa xác minh ⇒ unverified (không gửi)", { sent: ["s0"], unverified: ["s1"] }, "khong"],
  ];
  it.each(MA_TRAN)("%s", (_ten, bao, dau) => {
    expect(keHoachToastAbort(bc(bao)).dau).toBe(dau);
  });
  it("mỗi dòng 'khong' đứng MỘT MÌNH (sent rỗng) cũng không thành công", () => {
    for (const k of ["failed", "pending", "unverified"] as const) expect(keHoachToastAbort(bc({ [k]: ["s1"] })).dau).not.toBe("thanhCong");
  });
});

describe("moPhong (H38) — id trong sent mà lần giao chỉ MÔ PHỎNG", () => {
  it("★ sent = [s1], moPhong = [s1] ⇒ KHÔNG thành công, lý do moPhong", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], moPhong: ["s1"] }))).toEqual({ dau: "chuaBiet", lyDo: ["moPhong"] });
  });
  it("sent = [s1, s2], moPhong = [s1] ⇒ vẫn KHÔNG thành công (một bước chỉ mô phỏng là đủ)", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1", "s2"], moPhong: ["s1"] })).dau).toBe("chuaBiet");
  });
  it("moPhong rỗng hoặc vắng ⇒ không ảnh hưởng", () => {
    expect(keHoachToastAbort(bc({ sent: ["s1"], moPhong: [] })).dau).toBe("thanhCong");
    expect(keHoachToastAbort(bc({ sent: ["s1"] })).dau).toBe("thanhCong");
  });
  it("soGiaoThat: id mô phỏng KHÔNG tính là 'giao cho bộ điều phối'", () => {
    expect(soGiaoThat(bc({ sent: ["s1", "s2", "s3"], moPhong: ["s2"] }))).toBe(2);
    expect(soGiaoThat(bc({ sent: ["s1"], moPhong: ["s1"] }))).toBe(0);
    expect(soGiaoThat(bc({ sent: ["s1"] }))).toBe(1);
  });
});
