/**
 * SCADA R1a Task 14 — `ketQuaLenh.ts` (thuần): trạng thái kết quả lệnh ⇒ khoá chữ + tự đóng; mã từ chối ⇒ chữ người đọc + cách xử lý.
 *
 * Hợp đồng (brief Task 14 + điều phối 2026-10-24, báo cáo §4.6):
 *   - `acked_verified` ⇒ tự đóng sau 3000 ms; MỌI trạng thái khác ⇒ null (không tự đóng).
 *   - `acked_unverified` ⇒ hiện giá trị đọc lại (hoặc "không đọc được") + "kiểm tra tại máy".
 *   - `rejected` ⇒ khoá `scada.lenh.cong.<MÃ>`; POLICY_* gộp; mã lạ ⇒ dự phòng VẪN mang mã.
 *   - mọi khoá sinh ra có ở vi/en/zh; bản en/zh không chứa chữ Việt.
 */
import { describe, expect, it } from "vitest";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import {
  CONG_BIET,
  KHOA_LY_DO_LOCAL,
  LIEN_KET_DANG_KY_2FA,
  MA_LOI_LENH,
  TRANG_THAI_KET_QUA,
  TU_DONG_DONG_MS,
  docLoiApp,
  khoaLyDoLocal,
  moTaLoiLenh,
  nhanKetQua,
} from "./ketQuaLenh";

const BUNDLE = { vi: vi_, en: en_, zh: zh_ } as Record<string, unknown>;
const lay = (lng: string, k: string): unknown => k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], BUNDLE[lng]);
const S = (k: string, o?: Record<string, string | number>): string => {
  const v = lay("vi", k);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};
const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const coO3 = (k: string) => {
  for (const l of ["vi", "en", "zh"]) expect(typeof lay(l, k), `${l}:${k}`).toBe("string");
};

describe("nhanKetQua — trạng thái ⇒ chữ + tự đóng", () => {
  it("acked_verified ⇒ 'Đã ghi, đã đọc lại {v}', tự đóng sau đúng 3000 ms", () => {
    const r = nhanKetQua("acked_verified", { readBack: 240, requested: 240 });
    expect(r.tuDongDongMs).toBe(3000);
    expect(TU_DONG_DONG_MS).toBe(3000);
    expect(S(r.khoa, r.thamSo)).toBe("Đã ghi, đã đọc lại 240");
  });

  it("acked_unverified CÓ giá trị đọc lại ⇒ hiện giá trị + 'kiểm tra tại máy', KHÔNG tự đóng", () => {
    const r = nhanKetQua("acked_unverified", { readBack: 245, requested: 240 });
    expect(r.tuDongDongMs).toBeNull();
    expect(S(r.khoa, r.thamSo)).toBe("Đã ghi nhưng đọc lại ra 245 — kiểm tra tại máy");
  });

  it("acked_unverified KHÔNG đọc được (null / vắng) ⇒ 'không đọc được — kiểm tra tại máy', không tự đóng", () => {
    for (const readBack of [null, undefined]) {
      const r = nhanKetQua("acked_unverified", { readBack, requested: 240 });
      expect(r.tuDongDongMs).toBeNull();
      expect(S(r.khoa, r.thamSo)).toBe("Đã ghi nhưng không đọc lại được — kiểm tra tại máy");
    }
  });

  it("dinhDang của người gọi định dạng giá trị đọc lại (dấu thập phân theo ngôn ngữ)", () => {
    const r = nhanKetQua("acked_verified", { readBack: 240.5, requested: 240.5, dinhDang: (v) => String(v).replace(".", ",") });
    expect(S(r.khoa, r.thamSo)).toBe("Đã ghi, đã đọc lại 240,5");
  });

  it("simulated ⇒ 'Chế độ mô phỏng — không gửi tới máy', không tự đóng", () => {
    const r = nhanKetQua("simulated", { requested: 1 });
    expect(r.tuDongDongMs).toBeNull();
    expect(S(r.khoa, r.thamSo)).toBe("Chế độ mô phỏng — không gửi tới máy");
  });

  it("timeout ⇒ 'Không rõ máy đã nhận hay chưa — đọc lại giá trị trước khi gửi lần nữa', không tự đóng", () => {
    const r = nhanKetQua("timeout", { requested: 1 });
    expect(r.tuDongDongMs).toBeNull();
    expect(S(r.khoa, r.thamSo)).toBe("Không rõ máy đã nhận hay chưa — đọc lại giá trị trước khi gửi lần nữa");
  });

  it("rejected QUEUE_EXPIRED ⇒ 'Không gửi — lệnh chờ quá hạn; tạo yêu cầu mới'", () => {
    const r = nhanKetQua("rejected", { reason: "QUEUE_EXPIRED", requested: 1 });
    expect(r.khoa).toBe("scada.lenh.cong.QUEUE_EXPIRED");
    expect(r.tuDongDongMs).toBeNull();
    expect(S(r.khoa, r.thamSo)).toBe("Không gửi — lệnh chờ quá hạn; tạo yêu cầu mới");
  });

  it("rejected SAFETY_UNKNOWN ⇒ chữ 'Không đọc được trạng thái safety PLC'", () => {
    const r = nhanKetQua("rejected", { reason: "SAFETY_UNKNOWN", requested: 1 });
    expect(S(r.khoa, r.thamSo)).toContain("Không đọc được trạng thái safety PLC");
  });

  it("rejected — mỗi cổng biết có khoá riêng `scada.lenh.cong.<MÃ>` (đủ danh sách brief)", () => {
    for (const ma of [
      "QUEUE_EXPIRED",
      "BUSY",
      "INTERLOCK_BLOCKED",
      "SAFETY_UNKNOWN",
      "SAFETY_BLOCKED",
      "SAFETY_SIM_ONLY",
      "MODE_LOCAL",
      "OUT_OF_RANGE",
      "CHANNEL_READ_ONLY",
      "NOT_CONFIRMED",
      "ACTION_BINDING_MISMATCH",
      "ADAPTER_OFFLINE",
    ]) {
      expect(CONG_BIET).toContain(ma);
      const r = nhanKetQua("rejected", { reason: ma, requested: 1 });
      expect(r.khoa).toBe(`scada.lenh.cong.${ma}`);
      expect(S(r.khoa, r.thamSo)).not.toContain(ma); // chữ người đọc, không phải mã trần
    }
  });

  it("rejected POLICY_* ⇒ có khoá chính sách (POLICY_DENIED / POLICY_APPROVAL_REQUIRED riêng; POLICY_ lạ gộp và VẪN mang mã)", () => {
    expect(nhanKetQua("rejected", { reason: "POLICY_DENIED", requested: 1 }).khoa).toBe("scada.lenh.cong.POLICY_DENIED");
    expect(nhanKetQua("rejected", { reason: "POLICY_APPROVAL_REQUIRED", requested: 1 }).khoa).toBe("scada.lenh.cong.POLICY_APPROVAL_REQUIRED");
    const r = nhanKetQua("rejected", { reason: "POLICY_RATE_LIMIT", requested: 1 });
    expect(r.khoa).toBe("scada.lenh.cong.POLICY");
    expect(S(r.khoa, r.thamSo)).toContain("POLICY_RATE_LIMIT");
  });

  it("rejected mã CHƯA ánh xạ ⇒ dự phòng chung VẪN hiện mã; vắng mã ⇒ không ném", () => {
    const r = nhanKetQua("rejected", { reason: "GATE_FROM_THE_FUTURE", requested: 1 });
    expect(r.khoa).toBe("scada.lenh.cong.khac");
    expect(S(r.khoa, r.thamSo)).toContain("GATE_FROM_THE_FUTURE");
    expect(() => nhanKetQua("rejected", { requested: 1 })).not.toThrow();
    expect(nhanKetQua("rejected", { requested: 1 }).khoa).toBe("scada.lenh.cong.khac");
  });

  it("MỌI trạng thái trừ acked_verified ⇒ tuDongDongMs null", () => {
    for (const s of TRANG_THAI_KET_QUA) {
      const r = nhanKetQua(s, { requested: 1, reason: "BUSY", readBack: 1 });
      expect(r.tuDongDongMs, s).toBe(s === "acked_verified" ? 3000 : null);
    }
    expect(TRANG_THAI_KET_QUA).toEqual(expect.arrayContaining(["acked_verified", "acked_unverified", "simulated", "rejected", "timeout", "sent"]));
  });

  it("mọi khoá nhanKetQua sinh ra có ở vi/en/zh", () => {
    for (const s of TRANG_THAI_KET_QUA) {
      coO3(nhanKetQua(s, { requested: 1, readBack: 1 }).khoa);
      coO3(nhanKetQua(s, { requested: 1, readBack: null }).khoa);
    }
    for (const ma of [...CONG_BIET, "khac", "POLICY"]) coO3(`scada.lenh.cong.${ma}`);
  });
});

describe("moTaLoiLenh — mã từ chối ⇒ chữ + cách xử lý", () => {
  const loi = (appCode: string, appParams: Record<string, unknown>) => ({ data: { appCode, appParams } });

  it("docLoiApp đọc appCode/appParams; lỗi không có appCode ⇒ null", () => {
    expect(docLoiApp(loi("X", { ma: "Y" }))).toEqual({ appCode: "X", appParams: { ma: "Y" } });
    expect(docLoiApp(new Error("boom"))).toBeNull();
    expect(docLoiApp(null)).toBeNull();
  });

  it("mỗi mã của lenhHmi + DISPATCH_LOI + TIMEOUT có khoá `scada.lenh.loi.<MÃ>` ở vi/en/zh", () => {
    for (const ma of MA_LOI_LENH) coO3(`scada.lenh.loi.${ma}`);
    expect(MA_LOI_LENH).toEqual(
      expect.arrayContaining([
        "FEATURE_DISABLED", "NOT_FOUND", "CHANNEL_READ_ONLY", "TYPE_MISMATCH", "OUT_OF_RANGE", "OFF_STEP", "MODE_LOCAL", "DANG_DUOC_CHON",
        "EDGE_CHUA_HO_TRO", "ROLE_FLOOR", "PERMISSION_DENIED", "TOTP_CHUA_DANG_KY", "TOTP_CAN", "TOTP_SAI", "TOTP_TAM_KHOA",
        "TOTP_KHONG_KIEM_DUOC", "KHOA_CHON_LOI", "DA_XU_LY", "HET_HAN", "KHOA_MAT", "MAY_DA_DOI", "DISPATCH_LOI", "TIMEOUT",
      ]),
    );
  });

  it("OFF_STEP có goiY ⇒ chữ 'Giá trị phải theo bước {step}. Giá trị hợp lệ gần nhất: {goiY}' + goiY số", () => {
    const m = moTaLoiLenh(loi("SCADA_VALUE_OFF_STEP", { ma: "OFF_STEP", tagKey: "sp", step: 0.5, goiY: 240 }), "request", { laEdge: false, locale: "vi" });
    expect(m.goiY).toBe(240);
    expect(S(m.khoa, m.thamSo as Record<string, string>)).toBe("Giá trị phải theo bước 0,5. Giá trị hợp lệ gần nhất: 240");
  });

  it("OFF_STEP không goiY ⇒ khoá không gợi ý, không có goiY", () => {
    const m = moTaLoiLenh(loi("SCADA_VALUE_OFF_STEP_NO_HINT", { ma: "OFF_STEP", tagKey: "sp", step: 2 }), "request", { laEdge: false, locale: "vi" });
    expect(m.goiY).toBeUndefined();
    expect(m.khoa).toBe("scada.lenh.loi.OFF_STEP_NO_HINT");
  });

  it("MODE_LOCAL: mỗi lyDo có khoá (9 lý do) + gợi ý STOP; bo_dem_tat và chua_co_mau trên edge đúng chữ điều phối", () => {
    for (const k of Object.values(KHOA_LY_DO_LOCAL)) coO3(k);
    expect(Object.keys(KHOA_LY_DO_LOCAL).sort()).toEqual(
      ["remote", "chua_khai", "bo_dem_tat", "chua_co_mau", "chat_luong_xau", "cu", "khac_remote", "loi_doc", "kenh_sai_may"].sort(),
    );
    expect(S(khoaLyDoLocal("bo_dem_tat", false))).toBe("Bộ đệm giá trị sống đang tắt — mọi máy coi như LOCAL");
    expect(S(khoaLyDoLocal("chua_co_mau", true))).toBe("Máy do edge sở hữu — chưa có giá trị chế độ tới R1c");
    expect(S(khoaLyDoLocal("chua_co_mau", false))).not.toBe(S(khoaLyDoLocal("chua_co_mau", true)));
    expect(khoaLyDoLocal("la_ly_do_moi", false)).toBe("scada.lenh.local.khongRo");
    const m = moTaLoiLenh(loi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "bo_dem_tat" }), "request", { laEdge: false, locale: "vi" });
    expect(m.goiYStop).toBe(true);
    expect(m.khoaLyDo).toBe(khoaLyDoLocal("bo_dem_tat", false));
    expect(S("scada.lenh.loi.goiYStop")).toBe("Cần dừng máy? Dùng STOP đã ghim hoặc E-STOP cứng tại máy");
  });

  it("TOTP_CHUA_DANG_KY ⇒ liên kết đăng ký 2FA (trang /profile có thẻ 2FA)", () => {
    const m = moTaLoiLenh(loi("SCADA_TOTP_NOT_ENROLLED", { ma: "TOTP_CHUA_DANG_KY", level: 5 }), "confirm", { laEdge: false, locale: "vi" });
    expect(m.lienKet2FA).toBe(true);
    expect(LIEN_KET_DANG_KY_2FA).toBe("/profile");
    expect(S(m.khoa)).toBe("Lệnh mức 4–5 cần xác thực hai lớp; tài khoản của bạn chưa đăng ký");
  });

  it("TOTP_TAM_KHOA ⇒ số phút từ remainingMinutes; KHÔNG mang số lần thử", () => {
    const m = moTaLoiLenh(loi("TOTP_TAM_KHOA", { ma: "TOTP_TAM_KHOA", level: 5, remainingMinutes: 4, attempts: 5 }), "confirm", { laEdge: false, locale: "vi" });
    expect(S(m.khoa, m.thamSo as Record<string, string>)).toBe("Xác thực hai lớp đang tạm khoá do nhập sai nhiều lần — thử lại sau 4 phút");
    expect(Object.values(m.thamSo).map(String)).not.toContain("5");
    expect(m.giuYeuCau).toBe(false);
  });

  it("TOTP_CAN / TOTP_SAI / TOTP_KHONG_KIEM_DUOC GIỮ yêu cầu (người dùng nhập lại trong TTL); còn lại kết thúc", () => {
    for (const ma of ["TOTP_CAN", "TOTP_SAI", "TOTP_KHONG_KIEM_DUOC"]) {
      expect(moTaLoiLenh(loi("X", { ma, level: 5 }), "confirm", { laEdge: false, locale: "vi" }).giuYeuCau, ma).toBe(true);
    }
    for (const ma of ["MODE_LOCAL", "KHOA_MAT", "HET_HAN", "DA_XU_LY", "MAY_DA_DOI", "ROLE_FLOOR", "TOTP_TAM_KHOA"]) {
      expect(moTaLoiLenh(loi("X", { ma }), "confirm", { laEdge: false, locale: "vi" }).giuYeuCau, ma).toBe(false);
    }
  });

  it("EDGE_CHUA_HO_TRO ⇒ chữ có mã edge", () => {
    const m = moTaLoiLenh(loi("SCADA_EDGE_NOT_SUPPORTED", { ma: "EDGE_CHUA_HO_TRO", edgeCode: "EN-02" }), "request", { laEdge: true, locale: "vi" });
    expect(S(m.khoa, m.thamSo as Record<string, string>)).toBe("Máy này do edge EN-02 sở hữu — lệnh từ SCADA tới máy edge chưa được hỗ trợ (đợt R1c)");
  });

  it("MAY_DA_DOI ⇒ chữ điều phối", () => {
    const m = moTaLoiLenh(loi("SCADA_MACHINE_REBOUND", { ma: "MAY_DA_DOI" }), "confirm", { laEdge: false, locale: "vi" });
    expect(S(m.khoa)).toBe("Thiết bị đã được gán sang máy khác sau khi tạo yêu cầu — hãy tạo yêu cầu mới");
  });

  it("DANG_DUOC_CHON ⇒ tên người giữ + giờ hết hạn (định dạng theo ngôn ngữ)", () => {
    const m = moTaLoiLenh(
      loi("SCADA_TAG_SELECTED_BY_OTHER", { ma: "DANG_DUOC_CHON", boiUserId: 3, boiTen: "Nguyen Van A", hetHanLuc: "2026-10-24T07:05:00.000Z" }),
      "request",
      { laEdge: false, locale: "vi" },
    );
    expect(m.thamSo.ten).toBe("Nguyen Van A");
    expect(String(m.thamSo.den)).not.toBe("");
    expect(String(m.thamSo.den)).not.toContain("T07"); // không in ISO thô
  });

  it("confirm: lỗi KHÔNG mang mã (dispatch ném / mạng) ⇒ DISPATCH_LOI 'không rõ máy đã nhận'; request: ⇒ chung", () => {
    const c = moTaLoiLenh(new Error("socket hang up"), "confirm", { laEdge: false, locale: "vi" });
    expect(c.khoa).toBe("scada.lenh.loi.DISPATCH_LOI");
    const r = moTaLoiLenh(new Error("socket hang up"), "request", { laEdge: false, locale: "vi" });
    expect(r.khoa).toBe("scada.lenh.loi.khac");
  });

  it("mã lạ có `ma` ⇒ dự phòng chung, vẫn giữ mã để hiện", () => {
    const m = moTaLoiLenh(loi("SOMETHING_NEW", { ma: "MA_MOI" }), "request", { laEdge: false, locale: "vi" });
    expect(m.khoa).toBe("scada.lenh.loi.khac");
    expect(m.ma).toBe("MA_MOI");
  });
});

describe("i18n — scada.lenh / scada.faceplate", () => {
  const phang = (o: unknown, p = ""): Array<[string, string]> =>
    o && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => phang(v, p ? `${p}.${k}` : k))
      : [[p, String(o)]];
  for (const goc of ["scada.lenh", "scada.faceplate"]) {
    it(`${goc}: cùng tập khoá ở vi/en/zh; en/zh không có chữ Việt`, () => {
      const vi = phang(lay("vi", goc)).map(([k]) => k).sort();
      expect(vi.length).toBeGreaterThan(10);
      for (const l of ["en", "zh"]) {
        const ds = phang(lay(l, goc));
        expect(ds.map(([k]) => k).sort(), l).toEqual(vi);
        for (const [k, v] of ds) expect(CHU_VIET.test(v), `${l}:${goc}.${k} = ${v}`).toBe(false);
      }
    });
  }
});
