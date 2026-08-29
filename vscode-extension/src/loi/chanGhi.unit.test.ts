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
import { duocPhepGhi, duongTuongDoiTrongWorkspace } from "./chanGhi";

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

/**
 * ★★★ I-6 — LUẬT 4: "GỬI ĐƯỢC" VÀ "GHI ĐƯỢC" ĐÃ TÁCH ĐÁP ÁN.
 *
 * Mọi đường trong nhóm này đều **được phép GỬI** (`duocPhepGuiNoiDung` cho qua — chúng không phải
 * `.env`, không phải khoá riêng) nhưng ghi vào chúng là ĐẶT MÃ SẼ CHẠY trên máy lập trình viên, sau
 * một thẻ duyệt chỉ nói "Ghi vào workspace". Ca ĐỐI CHỨNG cuối nhóm chứng minh luật 4 không nuốt
 * nhầm mã thường — chặn nhầm là mất chức năng ÂM THẦM.
 */
describe("duocPhepGhi — luật 4: cấm CHỈ-KHI-GHI (I-6)", () => {
  it("★★★ .git/hooks/pre-commit ⇒ TỪ CHỐI (chạy ở lượt git kế tiếp)", () => {
    const r = duocPhepGhi("C:\\ws\\.git\\hooks\\pre-commit", ["C:\\ws"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toContain(".git");
  });

  it("★★★ mọi thứ dưới .git/ (config · hooks/post-merge · thư mục con sâu) ⇒ TỪ CHỐI", () => {
    for (const duong of [
      "C:\\ws\\.git\\config",
      "C:\\ws\\.git\\hooks\\post-merge",
      "C:\\ws\\.git\\modules\\sub\\hooks\\pre-push",
      "C:\\ws\\sub\\.git\\hooks\\pre-commit",
    ]) {
      expect(duocPhepGhi(duong, ["C:\\ws"]).ok, `${duong} phải bị chặn`).toBe(false);
    }
  });

  it("★★★ .vscode/tasks.json và .vscode/launch.json ⇒ TỪ CHỐI (VSCode chạy lệnh khai trong đó)", () => {
    for (const duong of ["C:\\ws\\.vscode\\tasks.json", "C:\\ws\\.vscode\\launch.json"]) {
      const r = duocPhepGhi(duong, ["C:\\ws"]);
      expect(r.ok, `${duong} phải bị chặn`).toBe(false);
      if (!r.ok) expect(r.lyDo).toContain(".vscode");
    }
  });

  it("★★★ ĐỐI CHỨNG: chính những đường đó ĐƯỢC PHÉP GỬI — hai câu hỏi đã tách đáp án", async () => {
    // Nếu ca này đỏ thì luật 4 là thừa (danh sách chung đã chặn rồi) và cả phán quyết I-6 sai.
    const { duocPhepGuiNoiDung } = await import("./nguCanh");
    for (const duong of ["C:\\ws\\.git\\hooks\\pre-commit", "C:\\ws\\.vscode\\tasks.json"]) {
      expect(duocPhepGuiNoiDung(duong), `${duong} phải GỬI được`).toBe(true);
    }
  });

  it("★★★ KHÔNG chặn nhầm: .gitignore · .github/workflows · src/gitUtils.ts · .vscode/settings.json ⇒ CHO", () => {
    // `.git` phải là NGUYÊN một đoạn đường dẫn, không phải chuỗi con. `.vscode/settings.json` là
    // đánh đổi ĐƯỢC BIẾT (xem docblock `camGhiRieng`), không phải chỗ bị bỏ quên.
    for (const duong of [
      "C:\\ws\\.gitignore",
      "C:\\ws\\.gitattributes",
      "C:\\ws\\.github\\workflows\\ci.yml",
      "C:\\ws\\src\\gitUtils.ts",
      "C:\\ws\\.vscode\\settings.json",
      "C:\\ws\\src\\tasks.json",
    ]) {
      expect(duocPhepGhi(duong, ["C:\\ws"]), `${duong} KHÔNG được bị chặn`).toEqual({ ok: true });
    }
  });

  it("★★ dấu phân cách kiểu POSIX cũng bị chặn (đường do model sinh hay dùng `/`)", () => {
    expect(duocPhepGhi("C:/ws/.git/hooks/pre-commit", ["C:\\ws"]).ok).toBe(false);
    expect(duocPhepGhi("C:/ws/.vscode/tasks.json", ["C:\\ws"]).ok).toBe(false);
  });
});

/**
 * ★★★ I-1 — SỔ KIỂM TOÁN PHẢI KHAI ĐÚNG TỆP NÀO VỪA ĐỔI.
 *
 * Nơi gọi cũ dùng `path.relative(gốc CHƯA giải liên kết, đích ĐÃ giải)` — hai hệ quy chiếu khác
 * nhau. Byte vẫn rơi đúng chỗ; cái sai là LỜI KHAI về nó.
 */
describe("duongTuongDoiTrongWorkspace (I-1)", () => {
  it("★★★ tệp trong gốc ⇒ đường tương đối dùng dấu `/`, KHÔNG có `..`, kèm ĐÚNG gốc", () => {
    expect(duongTuongDoiTrongWorkspace("C:\\ws\\src\\a.ts", ["C:\\ws"])).toEqual({
      goc: "C:\\ws",
      duongTuongDoi: "src/a.ts",
    });
  });

  it("★★★ tệp nằm ở thư mục workspace THỨ HAI ⇒ lấy gốc CHỨA nó, không đẻ ra `..`", () => {
    // Đây là ca mà `relative(gốc-của-ô-chọn, đích)` cũ trả "../ws2/x.ts" — sổ khai một đường
    // không tồn tại trong bất kỳ workspace nào. Cặp {goc, duongTuongDoi} phải nói về CÙNG gốc.
    expect(duongTuongDoiTrongWorkspace("C:\\ws2\\x.ts", ["C:\\ws1", "C:\\ws2"])).toEqual({
      goc: "C:\\ws2",
      duongTuongDoi: "x.ts",
    });
  });

  it("★★★ KHÁC Ổ ĐĨA (Windows) ⇒ `undefined`, KHÔNG trả đường TUYỆT ĐỐI của máy dev", () => {
    // `path.relative("C:\\ws", "D:\\khac\\x.ts")` trả NGUYÊN "D:\khac\x.ts". Nếu hàm này để lọt,
    // đường tuyệt đối máy dev bị khai lên máy chủ và in lên thẻ duyệt.
    const r = duongTuongDoiTrongWorkspace("D:\\khac\\x.ts", ["C:\\ws"]);
    expect(r).toBeUndefined();
  });

  it("★★★ tệp NGOÀI mọi gốc ⇒ `undefined` (nơi gọi phải xử lý tường minh, không nhận chuỗi sai)", () => {
    expect(duongTuongDoiTrongWorkspace("C:\\ngoai\\x.ts", ["C:\\ws"])).toBeUndefined();
    expect(duongTuongDoiTrongWorkspace("C:\\ws-khac\\x.ts", ["C:\\ws"])).toBeUndefined();
  });

  it("★★ danh sách gốc RỖNG ⇒ `undefined`", () => {
    expect(duongTuongDoiTrongWorkspace("C:\\ws\\a.ts", [])).toBeUndefined();
  });

  it("★★ CHÍNH thư mục gốc ⇒ `undefined` (không phải một tệp con)", () => {
    expect(duongTuongDoiTrongWorkspace("C:\\ws", ["C:\\ws"])).toBeUndefined();
  });
});
