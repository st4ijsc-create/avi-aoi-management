/**
 * L-7 T4 — Test cho hàng rào AI (`aiControlGate.ts`).
 *
 * ★ CHỦ Ý: phần lớn là ca ÂM TÍNH. Một cổng an toàn được đo bằng những thứ nó
 *   CHẶN, không bằng những thứ nó cho qua. Một suite toàn ca dương tính sẽ xanh
 *   rực trên một cổng `return { choPhep: true }` — nghĩa là nó đo số 0.
 *
 * ★ Mỗi `it()` dưới đây đã được KIỂM CHỨNG BẰNG ĐỘT BIẾN (T5): phá đúng điều
 *   kiện nó đo trong mã thật ⇒ nó phải chuyển ĐỎ. Bảng đột biến nằm trong báo
 *   cáo L-7. Một test không kêu khi mã hỏng thì không phải test.
 *
 * Không chạm DB, không chạm thiết bị, không sleep (đồng hồ tiêm được).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  phanLoaiMuc,
  kiemCongAi,
  siriengChoAi,
  laTagAnToan,
  coAiOtBat,
  BoDemTanSuat,
  CO_AI_OT,
  type DauVaoCongAi,
} from "./aiControlGate";

// ── Đồ nghề ──────────────────────────────────────────────────────────────────

/** Môi trường với cờ AI BẬT — dùng cho các ca cần chứng minh "chặn dù cờ bật". */
const ENV_BAT: Record<string, string | undefined> = { [CO_AI_OT]: "true" };
/** Môi trường KHÔNG có cờ (mô phỏng .env chưa khai). */
const ENV_VANG: Record<string, string | undefined> = {};

/** Đồng hồ giả — test không bao giờ sleep. */
function dongHo(batDau = 1_000_000) {
  let t = batDau;
  return {
    now: () => t,
    tien: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Đầu vào "mọi thứ đều hợp lệ" — mọi ca âm tính dưới đây phá ĐÚNG MỘT thứ so
 * với cơ sở này. Nếu cơ sở này tự nó bị chặn thì mọi ca âm tính đều xanh vì lý
 * do sai, nên có một ca dương tính canh cơ sở (xem "cơ sở phải ĐƯỢC PHÉP").
 */
function coSo(ghiDe: Partial<DauVaoCongAi> = {}): DauVaoCongAi {
  return {
    toolName: "machine_stop",
    userId: 42,
    adapterId: 7,
    safety: "OK",
    env: ENV_BAT,
    now: dongHo().now,
    boDem: new BoDemTanSuat(),
    ...ghiDe,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// T4-A — phanLoaiMuc: FAIL-CLOSED
// ═════════════════════════════════════════════════════════════════════════════

describe("phanLoaiMuc — fail-closed (mặc định 5)", () => {
  it("★ ÂM TÍNH: tool KHÔNG NHẬN RA ⇒ mức 5 (chứng minh danh sách TRẮNG)", () => {
    expect(phanLoaiMuc("tool_chua_ton_tai")).toBe(5);
    expect(phanLoaiMuc("robot_move_to")).toBe(5);
    expect(phanLoaiMuc("machine_startt")).toBe(5); // gõ nhầm 1 ký tự
    expect(phanLoaiMuc("MACHINE_STOP")).toBe(5); // khác hoa/thường ⇒ KHÔNG khớp
    expect(phanLoaiMuc("")).toBe(5);
  });

  it("★ ÂM TÍNH: đầu vào rác (không phải chuỗi) ⇒ mức 5, không ném lỗi", () => {
    expect(phanLoaiMuc(undefined as unknown as string)).toBe(5);
    expect(phanLoaiMuc(null as unknown as string)).toBe(5);
    expect(phanLoaiMuc(123 as unknown as string)).toBe(5);
    expect(phanLoaiMuc({} as unknown as string)).toBe(5);
  });

  it("★ ÂM TÍNH: tên kế thừa Object.prototype KHÔNG được coi là đã phân loại", () => {
    // Nếu bảng tra dùng `BANG_TRA[name] ?? 5` mà không `hasOwnProperty`, thì
    // "toString"/"constructor" trả về một hàm (truthy) và lọt qua ⇒ mức sai.
    expect(phanLoaiMuc("toString")).toBe(5);
    expect(phanLoaiMuc("constructor")).toBe(5);
    expect(phanLoaiMuc("hasOwnProperty")).toBe(5);
    expect(phanLoaiMuc("__proto__")).toBe(5);
  });

  it("DƯƠNG TÍNH canh: phân loại đúng theo HƯỚNG NĂNG LƯỢNG", () => {
    // giảm năng lượng
    expect(phanLoaiMuc("machine_stop")).toBe(1);
    expect(phanLoaiMuc("machine_pause")).toBe(1);
    // ghi tham số không-an-toàn
    expect(phanLoaiMuc("set_yield_threshold")).toBe(3);
    expect(phanLoaiMuc("set_machine_param", "conveyor_speed")).toBe(3);
    // TĂNG năng lượng
    expect(phanLoaiMuc("machine_start")).toBe(4);
    expect(phanLoaiMuc("machine_reset")).toBe(4);
    // chuyển động vật lý / thay cả tập tham số
    expect(phanLoaiMuc("reject_divert")).toBe(5);
    expect(phanLoaiMuc("spi_printer_offset")).toBe(5);
    expect(phanLoaiMuc("select_recipe")).toBe(5);
    expect(phanLoaiMuc("download_job")).toBe(5);
    expect(phanLoaiMuc("acknowledge_machine_alarm")).toBe(5);
  });

  it("★ ÂM TÍNH: tag an-toàn NÂNG set_machine_param từ 3 lên 5", () => {
    // Cùng một tool, khác tag ⇒ khác mức. Đây là lý do tagKey phải đi tới cổng.
    expect(phanLoaiMuc("set_machine_param", "conveyor_speed")).toBe(3);
    for (const tag of [
      "safety_relay_reset",
      "estop_bypass",
      "interlock_mute",
      "guard_door_override",
      "light_curtain_mute",
      "robot_move_x",
      "torque_limit",
      "watchdog_disable",
    ]) {
      expect(phanLoaiMuc("set_machine_param", tag)).toBe(5);
    }
  });

  it("★ ÂM TÍNH: tag an-toàn nâng mức CẢ tool Mức 1 (stop cũng không được chạm safety)", () => {
    expect(phanLoaiMuc("machine_stop")).toBe(1);
    expect(phanLoaiMuc("machine_stop", "safety_plc_word")).toBe(5);
  });

  it("laTagAnToan: không khớp thì false, rác thì false (không ném)", () => {
    expect(laTagAnToan("conveyor_speed")).toBe(false);
    expect(laTagAnToan(null)).toBe(false);
    expect(laTagAnToan(undefined)).toBe(false);
    expect(laTagAnToan("")).toBe(false);
    expect(laTagAnToan("SAFETY_word")).toBe(true); // không phân biệt hoa/thường
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-B — Mức 4/5 bị chặn NGAY CẢ KHI mọi thứ khác hợp lệ
// ═════════════════════════════════════════════════════════════════════════════

describe("kiemCongAi — Mức ≥ 4 chặn cứng", () => {
  it("★★★ ÂM TÍNH: machine_start bị chặn DÙ cờ BẬT, safety OK, quota trống", () => {
    const kq = kiemCongAi(coSo({ toolName: "machine_start" }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("MUC_QUA_CAO");
    expect(kq.muc).toBe(4);
    // Thông điệp phải dạy model ĐỪNG THỬ LẠI — nếu không nó sẽ quay vòng lặp.
    expect(kq.lyDo).toMatch(/ĐỪNG THỬ LẠI/);
  });

  it("★★★ ÂM TÍNH: machine_reset bị chặn DÙ cờ BẬT và mọi thứ khác hợp lệ", () => {
    const kq = kiemCongAi(coSo({ toolName: "machine_reset" }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("MUC_QUA_CAO");
    expect(kq.muc).toBe(4);
  });

  it("★ ÂM TÍNH: Mức 4/5 bị chặn vì MỨC, không phải vì cờ — kiểm THỨ TỰ", () => {
    // Nếu kiểm cờ chạy TRƯỚC kiểm mức, thì với cờ TẮT ta sẽ thấy ma='CO_TAT'.
    // Đó là thông điệp SAI: nó dạy model rằng "bật cờ lên thì start được".
    const kq = kiemCongAi(coSo({ toolName: "machine_start", env: ENV_VANG }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("MUC_QUA_CAO"); // KHÔNG phải 'CO_TAT'
  });

  it("★ ÂM TÍNH: mọi tool Mức 5 bị chặn, gồm reject_divert (chuyển động vật lý)", () => {
    for (const t of [
      "reject_divert",
      "spi_printer_offset",
      "select_recipe",
      "download_job",
      "acknowledge_machine_alarm",
    ]) {
      const kq = kiemCongAi(coSo({ toolName: t }));
      expect(kq.choPhep, `${t} phải bị chặn`).toBe(false);
      expect(kq.ma).toBe("MUC_QUA_CAO");
      expect(kq.muc).toBe(5);
    }
  });

  it("★ ÂM TÍNH: tool lạ bị chặn qua đường cổng (fail-closed đầu-cuối)", () => {
    const kq = kiemCongAi(coSo({ toolName: "mot_tool_hoan_toan_moi" }));
    expect(kq.choPhep).toBe(false);
    expect(kq.muc).toBe(5);
    expect(kq.ma).toBe("MUC_QUA_CAO");
  });

  it("★ ÂM TÍNH: set_machine_param trên tag AN TOÀN bị chặn (mức 3 → nâng 5)", () => {
    const ok = kiemCongAi(coSo({ toolName: "set_machine_param", tagKey: "oven_temp" }));
    expect(ok.choPhep).toBe(true); // tag thường: qua

    const chan = kiemCongAi(coSo({ toolName: "set_machine_param", tagKey: "safety_speed_limit" }));
    expect(chan.choPhep).toBe(false);
    expect(chan.muc).toBe(5);
    expect(chan.ma).toBe("MUC_QUA_CAO");
  });

  it("★ ÂM TÍNH: Mức 4/5 KHÔNG tiêu quota (lệnh bị chặn không ăn suất lệnh hợp lệ)", () => {
    const boDem = new BoDemTanSuat(2, 60_000);
    const dh = dongHo();
    for (let i = 0; i < 10; i++) {
      kiemCongAi(coSo({ toolName: "machine_start", boDem, now: dh.now }));
    }
    // 10 lệnh bị chặn không được ăn mất 2 suất
    expect(boDem.demTrongCuaSo(42, 7, dh.now())).toBe(0);
    expect(kiemCongAi(coSo({ toolName: "machine_stop", boDem, now: dh.now })).choPhep).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-C — Cờ AI_OT_CONTROL_ENABLED
// ═════════════════════════════════════════════════════════════════════════════

describe("kiemCongAi — cờ riêng AI_OT_CONTROL_ENABLED", () => {
  it("★★★ ÂM TÍNH: cờ VẮNG MẶT ⇒ chặn (mặc định TẮT)", () => {
    const kq = kiemCongAi(coSo({ env: ENV_VANG }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("CO_TAT");
  });

  it("★ ÂM TÍNH: cờ sai chính tả / gần đúng ⇒ VẪN chặn (chỉ chấp nhận 'true')", () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", "", " true", "true ", "false"]) {
      const kq = kiemCongAi(coSo({ env: { [CO_AI_OT]: v } }));
      expect(kq.choPhep, `giá trị cờ ${JSON.stringify(v)} KHÔNG được coi là bật`).toBe(false);
      expect(kq.ma).toBe("CO_TAT");
    }
  });

  it("★★★ ÂM TÍNH: bật OT_CONTROL_ENABLED KHÔNG mở cổng AI (hai cờ RIÊNG BIỆT)", () => {
    // Đây là bất biến quan trọng nhất của cờ: máy đang chạy có
    // OT_CONTROL_ENABLED=true. Nếu cổng AI đọc nhầm cờ đó, hàng rào này = 0.
    const kq = kiemCongAi(
      coSo({
        env: { OT_CONTROL_ENABLED: "true", ROBOT_CONTROL_ENABLED: "true" },
      }),
    );
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("CO_TAT");
  });

  it("★ ÂM TÍNH: cờ TẮT ⇒ KHÔNG tiêu quota", () => {
    const boDem = new BoDemTanSuat(2, 60_000);
    const dh = dongHo();
    for (let i = 0; i < 5; i++) {
      kiemCongAi(coSo({ env: ENV_VANG, boDem, now: dh.now }));
    }
    expect(boDem.demTrongCuaSo(42, 7, dh.now())).toBe(0);
  });

  it("coAiOtBat: chỉ đúng chuỗi 'true'", () => {
    expect(coAiOtBat({ [CO_AI_OT]: "true" })).toBe(true);
    expect(coAiOtBat({ [CO_AI_OT]: "TRUE" })).toBe(false);
    expect(coAiOtBat({})).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-D — Trần tần suất
// ═════════════════════════════════════════════════════════════════════════════

describe("kiemCongAi — trần tần suất", () => {
  it("★★★ ÂM TÍNH: vượt trần ⇒ chặn", () => {
    const boDem = new BoDemTanSuat(3, 60_000);
    const dh = dongHo();
    const dv = () => coSo({ boDem, now: dh.now });

    expect(kiemCongAi(dv()).choPhep).toBe(true); // 1
    expect(kiemCongAi(dv()).choPhep).toBe(true); // 2
    expect(kiemCongAi(dv()).choPhep).toBe(true); // 3
    const qua = kiemCongAi(dv()); // 4 ⇒ vượt
    expect(qua.choPhep).toBe(false);
    expect(qua.ma).toBe("VUOT_TRAN_TAN_SUAT");
    expect(qua.lyDo).toMatch(/ĐỪNG THỬ LẠI NGAY/);
  });

  it("★ ÂM TÍNH: thử lại lập tức sau khi vượt trần VẪN bị chặn (không có cửa lách)", () => {
    const boDem = new BoDemTanSuat(1, 60_000);
    const dh = dongHo();
    kiemCongAi(coSo({ boDem, now: dh.now }));
    for (let i = 0; i < 20; i++) {
      expect(kiemCongAi(coSo({ boDem, now: dh.now })).ma).toBe("VUOT_TRAN_TAN_SUAT");
    }
  });

  it("cửa sổ TRƯỢT: hết cửa sổ thì quota hồi (đồng hồ tiêm, KHÔNG sleep)", () => {
    const boDem = new BoDemTanSuat(2, 60_000);
    const dh = dongHo();
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(true);
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(true);
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(false);

    dh.tien(59_000); // vẫn trong cửa sổ
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(false);

    dh.tien(2_000); // 61s ⇒ hai mốc đầu rơi khỏi cửa sổ
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(true);
  });

  it("★ quota TÁCH RIÊNG theo (người dùng, adapter) — không rò sang nhau", () => {
    const boDem = new BoDemTanSuat(1, 60_000);
    const dh = dongHo();
    expect(kiemCongAi(coSo({ boDem, now: dh.now, userId: 1, adapterId: 1 })).choPhep).toBe(true);
    // cùng người, KHÁC adapter ⇒ quota riêng
    expect(kiemCongAi(coSo({ boDem, now: dh.now, userId: 1, adapterId: 2 })).choPhep).toBe(true);
    // KHÁC người, cùng adapter ⇒ quota riêng
    expect(kiemCongAi(coSo({ boDem, now: dh.now, userId: 2, adapterId: 1 })).choPhep).toBe(true);
    // lặp lại cặp đầu ⇒ hết quota
    expect(kiemCongAi(coSo({ boDem, now: dh.now, userId: 1, adapterId: 1 })).choPhep).toBe(false);
  });

  it("tieuQuota:false (preview/dry-run) chấm điểm mà KHÔNG tiêu suất", () => {
    const boDem = new BoDemTanSuat(1, 60_000);
    const dh = dongHo();
    for (let i = 0; i < 5; i++) {
      expect(kiemCongAi(coSo({ boDem, now: dh.now, tieuQuota: false })).choPhep).toBe(true);
    }
    expect(boDem.demTrongCuaSo(42, 7, dh.now())).toBe(0);
    expect(kiemCongAi(coSo({ boDem, now: dh.now })).choPhep).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-E — Safety-PLC: fail-CLOSED cho AI (★ ngược dispatcher dòng 660)
// ═════════════════════════════════════════════════════════════════════════════

describe("kiemCongAi — safety-PLC fail-closed", () => {
  it("★★★ ÂM TÍNH: safety UNKNOWN ⇒ AI bị CHẶN (người vẫn được qua ở dispatcher)", () => {
    const kq = kiemCongAi(coSo({ safety: "UNKNOWN" }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("SAFETY_KHONG_XAC_DINH");
  });

  it("★★★ ÂM TÍNH: safety VẮNG MẶT ⇒ coi như UNKNOWN ⇒ chặn", () => {
    // Quên truyền safety KHÔNG được biến thành "cho qua".
    const kq = kiemCongAi(coSo({ safety: undefined }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("SAFETY_KHONG_XAC_DINH");
  });

  it("★ ÂM TÍNH: safety BLOCKED ⇒ chặn", () => {
    const kq = kiemCongAi(coSo({ safety: "BLOCKED" }));
    expect(kq.choPhep).toBe(false);
    expect(kq.ma).toBe("SAFETY_CHAN");
  });

  it("★ ÂM TÍNH: giá trị safety rác ⇒ chặn (không suy diễn thành OK)", () => {
    for (const v of ["ok", "Ok", "SAFE", "", "true", null]) {
      const kq = kiemCongAi(coSo({ safety: v as never }));
      expect(kq.choPhep, `safety=${JSON.stringify(v)} KHÔNG được coi là OK`).toBe(false);
    }
  });

  it("★ ÂM TÍNH: safety không-OK ⇒ KHÔNG tiêu quota", () => {
    const boDem = new BoDemTanSuat(2, 60_000);
    const dh = dongHo();
    for (let i = 0; i < 5; i++) kiemCongAi(coSo({ safety: "UNKNOWN", boDem, now: dh.now }));
    expect(boDem.demTrongCuaSo(42, 7, dh.now())).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-F — Cơ sở phải ĐƯỢC PHÉP (canh chống "cổng chặn tất")
// ═════════════════════════════════════════════════════════════════════════════

describe("kiemCongAi — ca dương tính canh", () => {
  it("★ CANH: cơ sở hợp lệ ĐƯỢC PHÉP — nếu ca này đỏ thì mọi ca âm tính vô nghĩa", () => {
    // Một cổng `return {choPhep:false}` sẽ làm MỌI ca âm tính ở trên xanh rực.
    // Ca này là thứ duy nhất phân biệt "cổng đúng" với "cổng chặn tất".
    const kq = kiemCongAi(coSo());
    expect(kq.choPhep).toBe(true);
    expect(kq.ma).toBe("CHO_PHEP");
    expect(kq.muc).toBe(1);
  });

  it("★ CANH: cả 3 tool Mức 1/3 hợp lệ đều qua được", () => {
    const boDem = new BoDemTanSuat(10, 60_000);
    const dh = dongHo();
    for (const t of ["machine_stop", "machine_pause", "set_yield_threshold"]) {
      expect(kiemCongAi(coSo({ toolName: t, boDem, now: dh.now })).choPhep, t).toBe(true);
    }
    expect(kiemCongAi(coSo({ toolName: "set_machine_param", tagKey: "oven_temp", boDem, now: dh.now })).choPhep).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-G — T3: acked_unverified ⇒ ok:false cho AI
// ═════════════════════════════════════════════════════════════════════════════

describe("siriengChoAi — acked_unverified KHÔNG phải thành công với AI", () => {
  it("★★★ ÂM TÍNH: acked_unverified + ok:true ⇒ AI thấy ok:false", () => {
    const cuaDispatcher = { ok: true, status: "acked_unverified", simulated: false };
    const choAi = siriengChoAi(cuaDispatcher);
    expect(choAi.ok).toBe(false);
    expect(choAi.status).toBe("acked_unverified"); // status giữ nguyên — trung thực
    expect(String(choAi.reason)).toMatch(/READBACK_KHONG_XAC_NHAN/);
  });

  it("★ KHÔNG đổi ngữ nghĩa dispatcher: bản gốc KHÔNG bị sửa tại chỗ", () => {
    // Nếu hàm này mutate, nó ĐÃ đổi hành vi cho cả đường NGƯỜI — vi phạm đúng
    // ràng buộc kiến trúc mà chủ dự án chốt.
    const goc = { ok: true, status: "acked_unverified" };
    const choAi = siriengChoAi(goc);
    expect(goc.ok).toBe(true); // ★ bản gốc còn nguyên
    expect(choAi.ok).toBe(false);
    expect(choAi).not.toBe(goc);
  });

  it("★ acked_verified KHÔNG bị hạ xuống false (không quá tay)", () => {
    expect(siriengChoAi({ ok: true, status: "acked_verified" }).ok).toBe(true);
    expect(siriengChoAi({ ok: true, status: "acked" }).ok).toBe(true);
    expect(siriengChoAi({ ok: true, status: "simulated" }).ok).toBe(true);
  });

  it("★ đã ok:false thì giữ nguyên reason gốc (không nuốt lý do thật)", () => {
    const kq = siriengChoAi({ ok: false, status: "acked_unverified", reason: "LY_DO_GOC" });
    expect(kq.ok).toBe(false);
    expect(kq.reason).toBe("LY_DO_GOC");
  });

  it("★ đầu vào rác không làm nổ (null/undefined đi thẳng qua)", () => {
    expect(siriengChoAi(null as never)).toBeNull();
    expect(siriengChoAi(undefined as never)).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T4-H — BoDemTanSuat đơn vị
// ═════════════════════════════════════════════════════════════════════════════

describe("BoDemTanSuat", () => {
  let boDem: BoDemTanSuat;
  beforeEach(() => {
    boDem = new BoDemTanSuat(3, 10_000);
  });

  it("đếm rỗng khi chưa có gì", () => {
    expect(boDem.demTrongCuaSo(1, 1, 5_000)).toBe(0);
    expect(boDem.daChamTran(1, 1, 5_000)).toBe(false);
  });

  it("mốc cũ hơn cửa sổ bị dọn", () => {
    boDem.ghiNhan(1, 1, 1_000);
    boDem.ghiNhan(1, 1, 2_000);
    expect(boDem.demTrongCuaSo(1, 1, 5_000)).toBe(2);
    expect(boDem.demTrongCuaSo(1, 1, 12_500)).toBe(0); // cả hai đã ra khỏi cửa sổ 10s
  });

  it("daChamTran đúng ở đúng biên", () => {
    boDem.ghiNhan(1, 1, 1_000);
    boDem.ghiNhan(1, 1, 1_000);
    expect(boDem.daChamTran(1, 1, 1_000)).toBe(false); // 2/3
    boDem.ghiNhan(1, 1, 1_000);
    expect(boDem.daChamTran(1, 1, 1_000)).toBe(true); // 3/3
  });
});
