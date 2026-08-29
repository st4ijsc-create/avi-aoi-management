/**
 * LƯỚI cho `duocPhepGhi` — vị từ chặn ghi cục bộ (Đợt C, Task 3). Đây là **nơi cưỡng chế** thay
 * cho máy chủ khi mã chạy trên máy dev (spec §4.1: chế độ SERVER thì máy chủ giữ tệp nên máy chủ
 * cưỡng chế được; chế độ LOCAL thì mã nằm trên máy dev, máy chủ không với tới ⇒ nơi cưỡng chế
 * CHUYỂN VÀO extension). Nếu vị từ này lỏng, không còn gì đứng giữa model và tệp của người dùng.
 *
 * Ba luật, đúng thứ tự kiểm: (1) phải TUYỆT ĐỐI · (2) phải TRONG một thư mục workspace đang mở,
 * chặn cả `..` thoát ra lẫn bẫy TIỀN TỐ CHUỖI (`C:\ws-khac` không phải `C:\ws`) · (3) cấm tệp
 * nhạy cảm — DÙNG LẠI `duocPhepGuiNoiDung` (xem docblock ở `chanGhi.ts`, KHÔNG viết bản thứ hai).
 */
import { describe, it, expect } from "vitest";
import { duocPhepGhi } from "./chanGhi";

describe("duocPhepGhi", () => {
  it("★★★ tệp trong workspace ⇒ {ok:true}", () => {
    const r = duocPhepGhi("C:\\ws\\src\\a.ts", ["C:\\ws"]);
    expect(r).toEqual({ ok: true });
  });

  it("★★★ tệp NGOÀI mọi workspace ⇒ từ chối, có lyDo", () => {
    const r = duocPhepGhi("C:\\khac\\a.ts", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★★★ `..` thoát ra ngoài SAU KHI CHUẨN HOÁ ⇒ từ chối", () => {
    const r = duocPhepGhi("C:\\ws\\..\\ngoai\\x.cs", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★★★ BẪY TIỀN TỐ CHUỖI: workspace C:\\ws, đường C:\\ws-khac\\x.cs ⇒ từ chối", () => {
    // Chuỗi bắt đầu giống nhau nhưng là hai thư mục KHÁC NHAU — lỗ kinh điển nếu so bằng
    // `startsWith` thô thay vì so theo ranh giới thư mục thật (path.relative).
    const r = duocPhepGhi("C:\\ws-khac\\x.cs", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★★★ .env / .env.local / sub/.env.production ⇒ từ chối", () => {
    for (const duong of ["C:\\ws\\.env", "C:\\ws\\.env.local", "C:\\ws\\sub\\.env.production"]) {
      const r = duocPhepGhi(duong, ["C:\\ws"]);
      expect(r.ok, `${duong} phải bị chặn`).toBe(false);
      if (!r.ok) expect(r.lyDo).not.toBe("");
    }
  });

  it("★★★ khoá riêng (id_rsa_work / server.key / store.jks) ⇒ từ chối", () => {
    for (const duong of ["C:\\ws\\id_rsa_work", "C:\\ws\\server.key", "C:\\ws\\store.jks"]) {
      const r = duocPhepGhi(duong, ["C:\\ws"]);
      expect(r.ok, `${duong} phải bị chặn`).toBe(false);
      if (!r.ok) expect(r.lyDo).not.toBe("");
    }
  });

  it("★★★ KHÔNG chặn nhầm mã thường: src/env.ts, src/keyboard.ts, src/Calculator.cs ⇒ CHO", () => {
    // Chặn nhầm là mất chức năng ÂM THẦM — người dùng không hiểu vì sao AI "không sửa được tệp này".
    for (const duong of ["C:\\ws\\src\\env.ts", "C:\\ws\\src\\keyboard.ts", "C:\\ws\\src\\Calculator.cs"]) {
      expect(duocPhepGhi(duong, ["C:\\ws"]), `${duong} KHÔNG được bị chặn`).toEqual({ ok: true });
    }
  });

  it("★★ đường TƯƠNG ĐỐI ⇒ từ chối", () => {
    const r = duocPhepGhi("src\\a.ts", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★★ danh sách workspace RỖNG ⇒ từ chối tất, kể cả đường tuyệt đối hợp lệ khác", () => {
    const r = duocPhepGhi("C:\\ws\\src\\a.ts", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★★ chính thư mục workspace (không phải tệp con) ⇒ từ chối — không ghi đè một thư mục", () => {
    const r = duocPhepGhi("C:\\ws", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).not.toBe("");
  });

  it("★ hoa/thường khác nhau trên Windows (c:\\ws\\x.cs vs workspace C:\\ws) ⇒ vẫn CHO", () => {
    expect(duocPhepGhi("c:\\ws\\x.cs", ["C:\\ws"])).toEqual({ ok: true });
  });
});
