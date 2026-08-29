/**
 * ★★★ R-C5 — LƯỚI CHỨNG MINH HÀNG RÀO CŨ **MÙ**, VÀ HÀNG RÀO MỚI THẤY.
 *
 * Điểm mấu chốt của tệp lưới này KHÔNG phải "giaiDuongThat trả về đúng chuỗi", mà là cặp khẳng
 * định ĐỐI CHỨNG ở ca liên-kết-thoát-ra:
 *   · `duocPhepGhi(<đường CHƯA giải>, [ws])` → **ok:true**  ⇐ hàng rào cũ CHO QUA (đó là lỗ);
 *   · `duocPhepGhi(<đường ĐÃ giải>,  [ws])` → **ok:false** ⇐ hàng rào mới CHẶN.
 * Thiếu vế thứ nhất thì lưới không chứng minh được gì: một lưới chỉ nói "chặn được" cũng xanh y
 * hệt khi cái nó đang đo vốn đã bị chặn sẵn vì một lý do khác.
 *
 * ⚠ MÔI TRƯỜNG: trên Windows, tạo symlink TỆP (và symlink THƯ MỤC kiểu "dir") cần quyền
 *   Administrator/Developer Mode — đo trên máy chạy lưới này thì cả hai đều `EPERM`. **JUNCTION**
 *   thư mục thì KHÔNG cần quyền và vẫn là reparse point mà `realpath` phải đi theo, nên ca thoát-ra
 *   dùng junction (trên POSIX dùng symlink thư mục — cùng ý nghĩa). Ca symlink TỆP tự khai ngay
 *   trong TÊN ca khi môi trường không tạo được, thay vì im lặng bỏ qua.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { giaiDuongThat } from "./duongThat";
import { duocPhepGhi } from "./chanGhi";

const LOAI_LK_THU_MUC = process.platform === "win32" ? "junction" : "dir";

// ⚠ Dựng cây tạm ở TẦNG MODULE, KHÔNG trong `beforeAll`: TÊN của ca cuối phải nói được môi trường
// có tạo nổi symlink TỆP hay không, mà tên ca được tính lúc THU THẬP — trước khi `beforeAll` chạy.
// Đặt trong `beforeAll` thì cảnh báo môi trường sẽ không bao giờ hiện ra, tức lại thành "bỏ qua im
// lặng" — đúng thứ đề bài cấm.
// `realpathSync` ngay từ đầu: trên macOS `/var` là symlink của `/private/var`, không giải gốc tạm
// thì MỌI phép so bên dưới lệch vì một lý do chẳng liên quan gì tới cái đang đo.
const goc = realpathSync(mkdtempSync(join(tmpdir(), "duongthat-")));
const ws = join(goc, "ws");
const ngoai = join(goc, "ngoai");
mkdirSync(ws);
mkdirSync(ngoai);
// ⚠ Các "mục có thật" dưới đây là THƯ MỤC, không phải tệp — cố ý. `giaiDuongThat` chỉ gọi
// `realpath`/`lstat`, hai thứ không quan tâm mục là tệp hay thư mục, nên ý nghĩa phép đo không
// đổi; đổi lại, lưới này KHÔNG cần một API ghi tệp nào, và census "0 lần `fs` ghi" giữ nguyên
// răng cho CẢ tệp lưới. (Census đã bắt đúng lúc bản nháp đầu dùng API ghi tệp ở đây.)
mkdirSync(join(ws, "trong-ws"));
mkdirSync(join(ngoai, "bi-mat"));
symlinkSync(ngoai, join(ws, "lk-ra-ngoai"), LOAI_LK_THU_MUC);
symlinkSync(join(goc, "khong-ton-tai"), join(ws, "lk-hong"), LOAI_LK_THU_MUC);

/** `null` ⇒ tạo được symlink TỆP; chuỗi ⇒ mã lỗi khiến không tạo được (xem docblock). */
let vuongSymlinkTep: string | null = null;
try {
  symlinkSync(join(ngoai, "bi-mat"), join(ws, "lk-tep-ra-ngoai"), "file");
} catch (e) {
  vuongSymlinkTep = (e as NodeJS.ErrnoException).code ?? "không rõ";
}

afterAll(() => {
  rmSync(goc, { recursive: true, force: true });
});

describe("giaiDuongThat", () => {
  it("★★★ đường TƯƠNG ĐỐI bị từ chối (không giải từ một gốc phải đoán)", () => {
    const kq = giaiDuongThat("src/Calculator.cs");
    expect(kq.ok).toBe(false);
    expect(kq.ok === false && kq.lyDo).toContain("không tuyệt đối");
  });

  it("★★ tệp CÓ THẬT ⇒ trả đúng đường thật", () => {
    const p = join(ws, "trong-ws");
    const kq = giaiDuongThat(p);
    expect(kq).toEqual({ ok: true, duong: realpathSync(p) });
  });

  it("★★ tệp CHƯA tồn tại trong thư mục có thật ⇒ giải THƯ MỤC CHA rồi ghép tên tệp", () => {
    const kq = giaiDuongThat(join(ws, "chua-co.txt"));
    expect(kq).toEqual({ ok: true, duong: join(realpathSync(ws), "chua-co.txt") });
  });

  it("★★ thư mục cha cũng không tồn tại ⇒ từ chối, KHÔNG bịa ra một đường", () => {
    const kq = giaiDuongThat(join(ws, "khong-co-thu-muc-nay", "x.txt"));
    expect(kq.ok).toBe(false);
    expect(kq.ok === false && kq.lyDo).toContain("thư mục cha");
  });

  it("★★★ LIÊN KẾT THƯ MỤC THOÁT RA NGOÀI — hàng rào CHUỖI cho qua, hàng rào ĐƯỜNG-THẬT chặn", () => {
    const chuaGiai = join(ws, "lk-ra-ngoai", "bi-mat");

    // (a) ĐỐI CHỨNG: `duocPhepGhi` một mình — chỉ so chuỗi ⇒ CHO QUA. Đây chính là lỗ R-C5.
    expect(duocPhepGhi(chuaGiai, [ws])).toEqual({ ok: true });

    // (b) Giải đường thật ⇒ đường nằm NGOÀI workspace ⇒ bị chặn.
    const giai = giaiDuongThat(chuaGiai);
    expect(giai.ok).toBe(true);
    const duongThat = giai.ok ? giai.duong : "";
    expect(duongThat.startsWith(realpathSync(ngoai))).toBe(true);
    const phep = duocPhepGhi(duongThat, [realpathSync(ws)]);
    expect(phep.ok).toBe(false);
    expect(phep.ok === false && phep.lyDo).toContain("ngoài mọi thư mục workspace");
  });

  it("★★★ TỆP MỚI bên trong liên kết thoát ra ngoài cũng bị chặn (nhánh giải-thư-mục-cha)", () => {
    // Ca này quan trọng riêng: tệp chưa tồn tại nên `realpath` ném ENOENT và ta rơi vào nhánh giải
    // THƯ MỤC CHA — nhánh đó cũng phải đi theo liên kết, nếu không thì "tạo tệp mới qua liên kết"
    // trở thành đường vòng quanh toàn bộ hàng rào.
    const giai = giaiDuongThat(join(ws, "lk-ra-ngoai", "tep-moi.txt"));
    expect(giai.ok).toBe(true);
    const duongThat = giai.ok ? giai.duong : "";
    expect(duongThat).toBe(join(realpathSync(ngoai), "tep-moi.txt"));
    expect(duocPhepGhi(duongThat, [realpathSync(ws)]).ok).toBe(false);
  });

  it("★★★ LIÊN KẾT HỎNG (dangling) ⇒ TỪ CHỐI, không rơi về nhánh giải-thư-mục-cha", () => {
    // `realpath` ném ENOENT y hệt ca "tệp mới". Nếu không phân biệt bằng `lstat`, kết quả sẽ là một
    // đường NẰM TRONG workspace — trong khi ghi qua đó tạo tệp tại ĐÍCH của liên kết, ở bất kỳ đâu.
    const kq = giaiDuongThat(join(ws, "lk-hong"));
    expect(kq.ok).toBe(false);
    expect(kq.ok === false && kq.lyDo).toContain("liên kết HỎNG");
  });

  it(`★★★ symlink TỆP trỏ ra ngoài bị chặn${
    vuongSymlinkTep === null ? "" : " — [MÔI TRƯỜNG KHÔNG TẠO ĐƯỢC SYMLINK TỆP, xem lý do trong ca]"
  }`, () => {
    if (vuongSymlinkTep !== null) {
      // KHÔNG im lặng bỏ qua: ghi rõ giới hạn môi trường thành một khẳng định đọc được.
      expect(
        vuongSymlinkTep,
        `Không tạo được symlink TỆP trên môi trường này (mã ${vuongSymlinkTep}) — trên Windows cần Administrator/Developer Mode. Ca liên-kết-THƯ-MỤC ở trên vẫn phủ đúng lớp lỗi (cùng cơ chế reparse point), nhưng lớp symlink-TỆP CHƯA được đo trên máy này.`,
      ).toBe("EPERM");
      return;
    }
    const giai = giaiDuongThat(join(ws, "lk-tep-ra-ngoai"));
    expect(giai.ok).toBe(true);
    expect(duocPhepGhi(giai.ok ? giai.duong : "", [realpathSync(ws)]).ok).toBe(false);
  });
});
