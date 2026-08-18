/**
 * Trích dẫn NGUỒN DỮ LIỆU + đối chiếu số — thuần, không DB.
 *
 * Trọng tâm:
 *   • RBAC / fail-closed: `note` có mặt ⇒ KHÔNG citation (mọi loại note, không chỉ
 *     PERMISSION_DENIED) — luật chống rò sự-tồn-tại,
 *   • không rò dữ liệu: không giá trị hàng nào lọt vào citation,
 *   • tên bảng đã khai phải TỒN TẠI THẬT trong `drizzle/schema/**`,
 *   • đối chiếu số: đo được, có mẫu số, KHÔNG chặn câu trả lời.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDataCitation,
  reconcileAnswerNumbers,
  rutBoLoc,
  rutKhoangThoiGian,
  demSoHang,
  moTaTrichDanDuLieu,
  TOOL_PRIMARY_TABLE,
  type ToolResultLike,
} from "./dataCitation";

const OK_RESULT: ToolResultLike = {
  type: "today_stats",
  title: "Thống kê hôm nay",
  data: { rows: [{ machine: "M-01", ng: 12 }, { machine: "M-02", ng: 7 }] },
  textSummary: "Hôm nay: 19 NG trên 2 máy.",
};

describe("🔴 RBAC + fail-closed — `note` có mặt ⇒ KHÔNG citation", () => {
  it("PERMISSION_DENIED không sinh citation (không tiết lộ bảng `api_keys` tồn tại)", () => {
    // Hình dạng THẬT của lượt bị từ chối (readToolRbac.ts `ketQuaTuChoi`): `type`/`title`
    // GIỐNG HỆT lượt thành công, `data` được điền rỗng, chỉ `note` khác.
    const denied: ToolResultLike = {
      type: "api_key_list",
      title: "API keys",
      data: { keys: [] },
      textSummary: "Bạn không có quyền xem mục này.",
      note: "PERMISSION_DENIED",
    };
    expect(buildDataCitation("list_api_keys", denied, { role: "admin" })).toBeNull();
  });

  it("MỌI note khác cũng fail-closed (không chỉ PERMISSION_DENIED)", () => {
    for (const note of ["DB_UNAVAILABLE", "NOT_FOUND", "QUERY_ERROR", "MISSING_ARGS", "PROG_KB_DISABLED", "note-lạ-chưa-từng-có"]) {
      expect(buildDataCitation("get_today_stats", { ...OK_RESULT, note }, {})).toBeNull();
    }
  });

  it("note rỗng/khoảng trắng KHÔNG bị coi là note (không chặn oan lượt hợp lệ)", () => {
    expect(buildDataCitation("get_today_stats", { ...OK_RESULT, note: "" }, {})).not.toBeNull();
    expect(buildDataCitation("get_today_stats", { ...OK_RESULT, note: "   " }, {})).not.toBeNull();
  });

  it("thiếu tên tool hoặc thiếu kết quả ⇒ không citation", () => {
    expect(buildDataCitation(null, OK_RESULT, {})).toBeNull();
    expect(buildDataCitation("get_today_stats", null, {})).toBeNull();
  });
});

describe("🔴 không rò dữ liệu — citation chỉ mang SIÊU DỮ LIỆU", () => {
  it("không một giá trị hàng nào xuất hiện trong citation đã tuần tự hoá", () => {
    const nhayCam: ToolResultLike = {
      type: "user_list",
      title: "Người dùng",
      data: { users: [{ name: "Nguyễn Văn A", email: "a@example.com", phone: "0900123456" }] },
      textSummary: "1 người dùng.",
    };
    const c = buildDataCitation("list_users_by_role", nhayCam, { role: "operator" })!;
    const json = JSON.stringify(c);
    for (const bimat of ["Nguyễn Văn A", "a@example.com", "0900123456"]) {
      expect(json).not.toContain(bimat);
    }
    // …nhưng vẫn truy ngược được: bảng + bộ lọc + số hàng.
    expect(c.table).toBe("users");
    expect(c.filters).toEqual({ role: "operator" });
    expect(c.rowCount).toBe(1);
  });

  it("`__authCtx` (danh tính phiên) KHÔNG BAO GIỜ vào bộ lọc", () => {
    const args = { machineCode: "M-01", __authCtx: { userId: 42, role: "admin" }, password: "hunter2" };
    const c = buildDataCitation("get_machine_status", OK_RESULT, args)!;
    expect(c.filters).toEqual({ machineCode: "M-01" });
    expect(JSON.stringify(c)).not.toContain("hunter2");
    expect(JSON.stringify(c)).not.toContain("42");
  });

  it("★ `__authCtx` bị chặn vì TÊN KHOÁ, KHÔNG phải vì giá trị tình cờ là object", () => {
    // ⚠⚠ CA NÀY SINH RA TỪ MỘT ĐỘT BIẾN SỐNG (M10). Ca ngay bên trên **xanh qua một
    // CƠ CHẾ KHÁC** với cơ chế nó tưởng đang canh: `__authCtx` thật là một object, mà
    // `lamSachGiaTri` vốn đã loại MỌI object — nên gỡ `__authCtx` khỏi `KHOA_CAM` vẫn
    // xanh. Hai lớp phòng vệ chồng lên nhau, và ca cũ chỉ chứng minh được lớp DƯỚI.
    // Bất biến THẬT cần ghim: chặn theo **TÊN KHOÁ**, độc lập hoàn toàn với kiểu giá
    // trị — vì một danh tính phiên tuần tự hoá thành CHUỖI sẽ đi lọt qua lớp dưới.
    const c = buildDataCitation("get_machine_status", OK_RESULT, {
      machineCode: "M-01",
      __authCtx: "uid=42;role=admin", // vô hướng, lớp lọc-object KHÔNG chạm tới
    })!;
    expect(c.filters).toEqual({ machineCode: "M-01" });
    expect(JSON.stringify(c)).not.toContain("uid=42");
    expect(JSON.stringify(c)).not.toContain("admin");
  });

  it("★ mọi khoá nhạy cảm bị chặn theo TÊN kể cả khi giá trị là vô hướng", () => {
    const c = buildDataCitation("get_machine_status", OK_RESULT, {
      machineCode: "M-01",
      password: "hunter2",
      token: "eyJhbGciOi",
      secret: "s3cr3t",
      apiKey: "ak_live_1",
      api_key: "ak_live_2",
      key: "kkk",
    })!;
    expect(c.filters).toEqual({ machineCode: "M-01" });
  });

  it("giá trị object/mảng trong args không bị sao chép vào hoá đơn; chuỗi dài bị cắt", () => {
    const c = buildDataCitation("get_today_stats", OK_RESULT, {
      nested: { a: 1 },
      list: [1, 2, 3],
      dai: "x".repeat(200),
    })!;
    expect(c.filters.nested).toBeUndefined();
    expect(c.filters.list).toBeUndefined();
    expect(String(c.filters.dai).length).toBeLessThanOrEqual(65);
  });
});

describe("★ tên bảng đã khai phải TỒN TẠI THẬT trong drizzle schema", () => {
  it("mọi giá trị của TOOL_PRIMARY_TABLE khớp một `pgTable(\"…\")` có thật", () => {
    const dir = join(process.cwd(), "drizzle", "schema");
    const thatSu = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)) {
        thatSu.add(m[1]);
      }
    }
    expect(thatSu.size).toBeGreaterThan(100); // lưới tự-kiểm: đọc được schema thật
    const bia = Object.entries(TOOL_PRIMARY_TABLE).filter(([, t]) => !thatSu.has(t));
    expect(bia).toEqual([]);
  });

  it("tool KHÔNG có trong map ⇒ table = null (trung thực), citation vẫn phát ra", () => {
    const c = buildDataCitation("calc", { type: "action_result", data: { value: 7 }, textSummary: "7" }, {})!;
    expect(c.table).toBeNull();
    expect(c.dataset).toBe("action_result");
    expect(c.tool).toBe("calc");
  });
});

describe("đếm hàng — bảo thủ, không bịa", () => {
  it("mảng ⇒ độ dài; object 1 ô mảng ⇒ độ dài ô đó; object không mảng ⇒ 1", () => {
    expect(demSoHang([1, 2, 3])).toEqual({ rowCount: 3, basis: "array" });
    expect(demSoHang({ rows: [1, 2] })).toEqual({ rowCount: 2, basis: "field:rows" });
    expect(demSoHang({ ok: true })).toEqual({ rowCount: 1, basis: "single_object" });
  });

  it("nhiều ô mảng ⇒ null (không đoán ô nào là 'hàng')", () => {
    expect(demSoHang({ a: [1], b: [1, 2] })).toEqual({ rowCount: null, basis: null });
  });

  it("★ KHÔNG lấy `total`/`count` làm số hàng (chúng là TỔNG NGHIỆP VỤ)", () => {
    // 1.284 là tổng sản lượng, KHÔNG phải số hàng. Lấy nhầm ⇒ hoá đơn bịa.
    expect(demSoHang({ total: 1284, count: 99 }).rowCount).toBe(1);
    expect(demSoHang({ total: 1284, count: 99 }).basis).toBe("single_object");
  });
});

describe("bộ lọc + khoảng thời gian rút từ args THẬT", () => {
  it("khoá thời gian đi vào timeRange, không lặp ở filters", () => {
    const args = { machineCode: "M-01", days: 7, from: "2026-08-01", to: "2026-08-08" };
    expect(rutBoLoc(args)).toEqual({ machineCode: "M-01" });
    expect(rutKhoangThoiGian(args)).toEqual({ days: 7, from: "2026-08-01", to: "2026-08-08" });
  });

  it("không có ô thời gian ⇒ timeRange = null (KHÔNG bịa một cửa sổ mặc định)", () => {
    expect(rutKhoangThoiGian({ machineCode: "M-01" })).toBeNull();
    expect(rutKhoangThoiGian(undefined)).toBeNull();
  });

  it("dòng mô tả cho người đọc nêu đủ bảng · lọc · thời gian · số hàng", () => {
    const c = buildDataCitation("get_defect_trend", OK_RESULT, { machineCode: "M-01", days: 7 })!;
    const s = moTaTrichDanDuLieu(c, "vi");
    expect(s).toContain("product_inspections");
    expect(s).toContain("machineCode=M-01");
    expect(s).toContain("7d");
    expect(s).toContain("hàng");
  });
});

describe("đối chiếu số trong câu trả lời với toolResult", () => {
  const res: ToolResultLike = {
    type: "today_stats",
    data: { rows: [{ machine: "M-01", ng: 128, yield: 97.4 }] },
    textSummary: "M-01: 128 NG, yield 97.4%.",
  };

  it("số chép đúng từ dữ liệu ⇒ CÓ nguồn", () => {
    const r = reconcileAnswerNumbers("Máy M-01 có 128 NG, tỷ lệ đạt 97.4%.", res);
    expect(r.checked).toBeGreaterThan(0);
    expect(r.unsupported).toEqual([]);
    expect(r.accuracy).toBe(1);
  });

  it("★ số BỊA bị đánh dấu là không có nguồn", () => {
    const r = reconcileAnswerNumbers("Máy M-01 có 128 NG và 512 lỗi hàn.", res);
    expect(r.unsupported).toContain(512);
    expect(r.supported).toBeLessThan(r.checked);
    expect(r.accuracy).toBeLessThan(1);
  });

  it("làm tròn KHÔNG bị coi là bịa (97.4 ⇐ 97.42)", () => {
    const r = reconcileAnswerNumbers("Tỷ lệ đạt 97.4%.", { data: { yield: 97.42 } });
    expect(r.unsupported).toEqual([]);
  });

  it("ngày ISO, giờ và số thứ tự đầu dòng KHÔNG vào mẫu số", () => {
    const r = reconcileAnswerNumbers("Ngày 2026-08-16 lúc 14:30:\n1. việc A\n2. việc B", res);
    expect(r.checked).toBe(0);
    expect(r.accuracy).toBeNull(); // mẫu số 0 ⇒ KHÔNG quy ước thành 1
  });

  it("`textSummary` được tính là nguồn hợp lệ (chính nó là khối nhồi vào prompt)", () => {
    const r = reconcileAnswerNumbers("Có 42 đơn hàng.", { data: {}, textSummary: "Tổng: 42 đơn hàng đang mở." });
    expect(r.unsupported).toEqual([]);
  });

  it("dấu phân cách hàng nghìn kiểu vi và en đều khớp", () => {
    expect(reconcileAnswerNumbers("Sản lượng 1.284 sản phẩm.", { data: { total: 1284 } }).unsupported).toEqual([]);
    expect(reconcileAnswerNumbers("Output 1,284 units.", { data: { total: 1284 } }).unsupported).toEqual([]);
  });

  it("không có toolResult ⇒ mẫu số 0, accuracy null (KHÔNG khai 100%)", () => {
    const r = reconcileAnswerNumbers("Có 128 NG.", null);
    expect(r).toEqual({ checked: 0, supported: 0, unsupported: [], accuracy: null });
  });
});
