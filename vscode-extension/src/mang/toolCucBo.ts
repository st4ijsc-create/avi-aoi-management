/**
 * ★★★ BA TOOL ĐỌC CỤC BỘ — LỚP CHẠM `vscode` VÀ CHẠM ĐĨA. **CHỈ ĐỌC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỢT D KHÔNG MỞ ĐƯỜNG GHI NÀO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không nhánh nào trong tệp này đặt một byte lên đĩa. Census (`loi/census.unit.test.ts`) cưỡng chế
 * điều đó: đúng MỘT điểm áp-chỉnh-sửa ở `ui/apBanVa.ts`, và mọi API ghi/xoá/chép của hệ tệp phải
 * bằng 0 trên toàn tập vào bundle. Census đỏ vì tệp này = tệp này đi sai đường, không phải lưới
 * cần nới.
 *
 * ⚠ Và như `ui/apBanVa.ts` đã học: census soi VĂN BẢN, không phân biệt mã với bình luận. Docblock ở
 *   đây CỐ Ý không viết ra tên các API bị canh — nhắc tên chúng trong một câu giải thích cũng đủ
 *   làm phép đếm "đúng MỘT lần" nhảy lên 2 và census đỏ vì một câu chữ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN HÀNG RÀO, ĐÚNG THỨ TỰ — VÀ HÀNG RÀO 2 LÀ CÁI DỄ QUÊN NHẤT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Quy đường model khai về một đường tuyệt đối** — `giaiDuongDeXuat` (dùng lại của Đợt C).
 *      Workspace nhiều gốc: `x.ts` có thể là `app/x.ts` HOẶC `lib/x.ts`; khớp ≥ 2 tệp CÓ THẬT ⇒
 *      TỪ CHỐI, không đoán.
 *   2. **`giaiDuongThat` — GIẢI SYMLINK.** `path.resolve` là thao tác CHUỖI THUẦN: nó chuẩn hoá
 *      `..` nhưng **KHÔNG đi theo liên kết**. Một symlink NẰM TRONG workspace trỏ ra
 *      `C:\Users\…\.ssh\` sẽ **lọt qua nguyên vẹn** nếu chỉ so chuỗi — chuỗi thì trong workspace,
 *      còn tệp THẬT thì không. Cả đường ĐÍCH lẫn các GỐC workspace đều phải giải (giải một phía mà
 *      không giải phía kia thì phép so vẫn lệch).
 *   3. **`duocPhepDoc`** — trong workspace + không phải tệp nhạy cảm.
 *   4. **`locTapQuet` + `cheBiMat`** ở lớp thuần (`loi/docCucBo.ts`) — hai tầng của R-D2.
 *
 * ⚠⚠ Hàng rào 2 và 3 áp cho **TỪNG ứng viên** của `liet_ke`/`grep`, không chỉ cho thư mục gốc mà
 *    model khai. `findFiles` ĐI THEO liên kết, nên một liên kết trong workspace là một đường vòng
 *    hoàn chỉnh ra ngoài — vá ở thư mục gốc mà bỏ ngỏ từng ứng viên là vá đúng một nửa.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO ĐỌC BẰNG `node:fs` **ĐỒNG BỘ** CHỨ KHÔNG PHẢI `workspace.fs.readFile`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `grepThuan` nhận một hàm đọc TIÊM VÀO và dừng ngay khi chạm trần kết quả — nhờ đó **trần kết quả
 * cũng là trần SỐ TỆP BỊ MỞ RA**, một bất biến đo được (lưới đếm lời gọi hàm đọc). API async của
 * `workspace.fs` buộc phải đọc TRƯỚC toàn bộ ứng viên rồi mới lọc, tức mở ra hàng nghìn tệp để rồi
 * vứt đi — mất đúng bất biến ấy. Extension này vốn đã neo vào Node FS (`realpathSync` ở
 * `loi/duongThat.ts`, `existsSync` ở đường ghi Đợt C), nên đây không phải một ràng buộc mới.
 * ⚠ Đổi lại phải tự canh KÍCH THƯỚC trước khi đọc (`statSync`) — đọc đồng bộ một tệp 500 MB sẽ treo
 *   tiến trình extension.
 */
import * as vscode from "vscode";
import { existsSync, readFileSync, statSync } from "node:fs";
import { duongTuongDoiTrongWorkspace, giaiDuongDeXuat } from "../loi/chanGhi";
import { duocPhepGuiNoiDung } from "../loi/nguCanh";
import { giaiDuongThat } from "../loi/duongThat";
import type { YeuCauDoc } from "../loi/yeuCauDoc";
import {
  TRAN_BYTE_DOC_TEP,
  TRAN_KET_QUA_GREP,
  TRAN_MUC_LIET_KE,
  dinhDangDocTep,
  dinhDangLietKe,
  duocPhepDoc,
  grepThuan,
  lamSachLyDo,
  type UngVienQuet,
} from "../loi/docCucBo";

export type KetQuaToolCucBo = { ok: true; ketQua: string } | { ok: false; lyDo: string };

/**
 * Thư mục KHÔNG bao giờ đáng liệt kê/quét: rác build và phụ thuộc. Loại chúng ở đây là chuyện
 * TÍN HIỆU (model đọc `node_modules` thì hỏng câu trả lời), KHÔNG phải chuyện an toàn — an toàn do
 * `duocPhepGuiNoiDung` + `cheBiMat` lo. Đừng bao giờ đổi vai hai thứ đó cho nhau.
 */
const LOAI_TRU = "**/{node_modules,.git,dist,build,out,bin,obj,.next,.nuxt,coverage,.venv,venv,vendor,target,.gradle}/**";

/** Trần SỐ TỆP mà một lượt `findFiles` được trả về. Chạm trần ⇒ KHAI (xem `tapNguonBiCat`). */
const TRAN_TIM_LIET_KE = TRAN_MUC_LIET_KE * 8;
const TRAN_TIM_GREP = 4000;

/** Tệp lớn hơn mức này KHÔNG được quét bởi `grep` — gần như chắc chắn là tệp sinh tự động. */
const TRAN_BYTE_TEP_QUET = 1024 * 1024;
/** Tệp lớn hơn mức này thì `doc_tep` từ chối thay vì đọc đồng bộ cả khối rồi vứt đi 99%. */
const TRAN_BYTE_MO_TEP = 16 * 1024 * 1024;

/** Giải các gốc workspace về đường THẬT — cùng hệ quy chiếu với đường đích đã giải (hàng rào 2). */
function gocDaGiai(thuMucWorkspace: string[]): string[] {
  const ra: string[] = [];
  for (const ws of thuMucWorkspace) {
    const g = giaiDuongThat(ws);
    if (g.ok) ra.push(g.duong);
  }
  return ra;
}

/** Hàng rào 1 + 2 cho đường do MODEL khai. */
function quyVeDuongThat(duongModel: string, gocThat: string[]): { ok: true; duong: string } | { ok: false; lyDo: string } {
  const deXuat = giaiDuongDeXuat(duongModel, gocThat[0], gocThat, (p) => existsSync(p));
  if (!deXuat.ok) return deXuat;
  return giaiDuongThat(deXuat.duong);
}

/** Nhãn hiện cho model: đường TƯƠNG ĐỐI trong workspace, rơi về đường thật nếu không gốc nào chứa. */
function nhanGon(duongThat: string, gocThat: string[]): string {
  return duongTuongDoiTrongWorkspace(duongThat, gocThat)?.duongTuongDoi ?? duongThat;
}

/**
 * ★★★ Biến kết quả `findFiles` thành TẬP QUÉT đã qua hàng rào 2 + 3, TỪNG ỨNG VIÊN MỘT.
 *
 * ⚠ `findFiles` đi theo symlink. Không giải đường thật cho từng ứng viên là để ngỏ đúng đường vòng
 *   mà hàng rào 2 sinh ra để bịt — chỉ khác là nó đi qua `liet_ke`/`grep` thay vì `doc_tep`.
 * ⚠ Đường thật của một ứng viên có thể KHÁC đường `findFiles` khai; hàng rào tệp nhạy cảm phải hỏi
 *   trên đường THẬT (một liên kết tên `ghichu.txt` trỏ tới `id_rsa` phải bị chặn).
 *
 * ★★★ TRẢ VỀ CẢ `soNhayCam` — LỖ BẮT ĐƯỢC BẰNG PHÉP ĐO TRÊN ĐĨA THẬT, KHÔNG BẰNG LƯỚI.
 * Hàm này lọc tệp nhạy cảm TRƯỚC khi lớp thuần nhìn thấy chúng, nên lời khai "(đã loại N tệp nhạy
 * cảm)" của lớp thuần **biến mất trên đường chạy thật** — model nhận một danh sách trông như đầy
 * đủ. Xem docblock `dinhDangLietKe` trong `loi/docCucBo.ts`. Nơi lọc phải ĐẾM.
 * ⚠ Chỉ đếm phần bị loại vì NHẠY CẢM, không đếm phần thoát ra ngoài workspace (symlink) — cái sau
 *   vốn không thuộc dự án.
 */
function locUngVien(
  uris: readonly vscode.Uri[],
  gocThat: string[],
): { giu: UngVienQuet[]; soNhayCam: number } {
  const giu: UngVienQuet[] = [];
  let soNhayCam = 0;
  for (const u of uris) {
    const that = giaiDuongThat(u.fsPath);
    if (!that.ok) continue;
    if (!duocPhepGuiNoiDung(that.duong)) {
      soNhayCam++;
      continue;
    }
    if (!duocPhepDoc(that.duong, gocThat).ok) continue;
    giu.push({ duong: that.duong, nhan: nhanGon(that.duong, gocThat) });
  }
  return { giu, soNhayCam };
}

/** Nội dung tệp dạng chuỗi, hoặc `undefined` nếu là tệp nhị phân (model không dùng được byte thô). */
function docVanBan(duong: string, tranByte: number): string | undefined {
  const tt = statSync(duong, { throwIfNoEntry: false });
  if (!tt || tt.isDirectory() || tt.size > tranByte) return undefined;
  const buf = readFileSync(duong);
  // NUL trong 8 KB đầu ⇒ nhị phân. Đẩy byte thô của một tệp `.png` vào câu hỏi vừa vô dụng vừa
  // ngốn sạch ngân sách ngữ cảnh của lượt hỏi.
  if (buf.subarray(0, 8192).includes(0)) return undefined;
  return buf.toString("utf8");
}

async function chayDocTep(duongModel: string, gocThat: string[]): Promise<KetQuaToolCucBo> {
  const that = quyVeDuongThat(duongModel, gocThat);
  if (!that.ok) return that;

  const rao = duocPhepDoc(that.duong, gocThat);
  if (!rao.ok) return rao;

  const thongTin = statSync(that.duong, { throwIfNoEntry: false });
  if (!thongTin) {
    return { ok: false, lyDo: `không đọc được "${nhanGon(that.duong, gocThat)}" — tệp không tồn tại` };
  }
  if (thongTin.isDirectory()) {
    return { ok: false, lyDo: `"${nhanGon(that.duong, gocThat)}" là THƯ MỤC — dùng tool liet_ke cho thư mục` };
  }
  if (thongTin.size > TRAN_BYTE_MO_TEP) {
    return { ok: false, lyDo: `tệp quá lớn (${thongTin.size} byte) — từ chối mở để không treo trình soạn thảo` };
  }

  let noiDung: string | undefined;
  try {
    noiDung = docVanBan(that.duong, TRAN_BYTE_MO_TEP);
  } catch {
    return { ok: false, lyDo: `không đọc được "${nhanGon(that.duong, gocThat)}" — không có quyền?` };
  }
  if (noiDung === undefined) {
    return { ok: false, lyDo: `"${nhanGon(that.duong, gocThat)}" là tệp NHỊ PHÂN — không gửi byte thô` };
  }

  return { ok: true, ketQua: dinhDangDocTep(nhanGon(that.duong, gocThat), noiDung, TRAN_BYTE_DOC_TEP) };
}

async function chayLietKe(duongModel: string, gocThat: string[]): Promise<KetQuaToolCucBo> {
  const that = quyVeDuongThat(duongModel, gocThat);
  if (!that.ok) return that;

  // `choPhepChinhGoc = true`: liệt kê CHÍNH thư mục gốc workspace là thao tác thường gặp nhất.
  const rao = duocPhepDoc(that.duong, gocThat, true);
  if (!rao.ok) return rao;

  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(vscode.Uri.file(that.duong), "**/*"),
    LOAI_TRU,
    TRAN_TIM_LIET_KE,
  );
  const { giu, soNhayCam } = locUngVien(uris, gocThat);

  return {
    ok: true,
    ketQua: dinhDangLietKe(
      nhanGon(that.duong, gocThat),
      giu.map((u) => u.nhan),
      TRAN_MUC_LIET_KE,
      uris.length >= TRAN_TIM_LIET_KE,
      soNhayCam,
    ),
  };
}

async function chayGrep(mau: string, duongModel: string | undefined, gocThat: string[]): Promise<KetQuaToolCucBo> {
  // Không khai `path` ⇒ quét MỌI gốc workspace. Khai `path` ⇒ vẫn phải qua đủ hàng rào 1-3.
  let goc: vscode.Uri[];
  if (duongModel === undefined) {
    goc = gocThat.map((g) => vscode.Uri.file(g));
  } else {
    const that = quyVeDuongThat(duongModel, gocThat);
    if (!that.ok) return that;
    const rao = duocPhepDoc(that.duong, gocThat, true);
    if (!rao.ok) return rao;
    goc = [vscode.Uri.file(that.duong)];
  }

  const uris: vscode.Uri[] = [];
  for (const g of goc) {
    if (uris.length >= TRAN_TIM_GREP) break;
    uris.push(
      ...(await vscode.workspace.findFiles(
        new vscode.RelativePattern(g, "**/*"),
        LOAI_TRU,
        TRAN_TIM_GREP - uris.length,
      )),
    );
  }

  const { giu, soNhayCam } = locUngVien(uris, gocThat);
  const doc = (duong: string): string => {
    const s = docVanBan(duong, TRAN_BYTE_TEP_QUET);
    // Ném ⇒ `grepThuan` bỏ qua ĐÚNG tệp này (nhị phân / quá lớn), không hỏng cả lượt tìm.
    if (s === undefined) throw new Error("bỏ qua");
    return s;
  };

  return {
    ok: true,
    ketQua: grepThuan(mau, giu, doc, TRAN_KET_QUA_GREP, uris.length >= TRAN_TIM_GREP, soNhayCam),
  };
}

/**
 * Điểm vào DUY NHẤT của ba tool đọc cục bộ (Task 3 tiêu thụ hàm này).
 *
 * ⚠ Mọi nhánh trả về đều đã qua `cheBiMat` ở lớp thuần — kể cả `lyDo`. Đừng thêm một nhánh nào
 *   dựng chuỗi kết quả từ nội dung đĩa mà không đi qua `loi/docCucBo.ts`.
 */
export async function chayToolCucBo(y: YeuCauDoc, thuMucWorkspace: string[]): Promise<KetQuaToolCucBo> {
  const kq = await chayThat(y, thuMucWorkspace);
  // ★★★ CỬA CHÓT — mọi `lyDo` của tệp này đều nội suy một đường dẫn bắt nguồn từ chuỗi MODEL khai,
  //     và `lyDo` cũng là chuỗi RỜI MÁY. `ketQua` KHÔNG đi qua đây (nó đã che theo từng mảnh ở lớp
  //     thuần) — xem docblock `lamSachLyDo`.
  return kq.ok ? kq : { ok: false, lyDo: lamSachLyDo(kq.lyDo) };
}

async function chayThat(y: YeuCauDoc, thuMucWorkspace: string[]): Promise<KetQuaToolCucBo> {
  const gocThat = gocDaGiai(thuMucWorkspace);
  if (gocThat.length === 0) {
    return { ok: false, lyDo: "không có thư mục workspace nào đang mở — từ chối mọi lượt đọc cục bộ" };
  }

  try {
    if (y.loai === "doc_tep") return await chayDocTep(y.path, gocThat);
    if (y.loai === "liet_ke") return await chayLietKe(y.path, gocThat);
    return await chayGrep(y.mau, y.path, gocThat);
  } catch (e) {
    // ⚠ KHÔNG để lộ nguyên văn lỗi hệ thống ra ngoài: `err.message` của Node mang đường dẫn tuyệt
    //   đối của máy dev, và đây là một chuỗi RỜI MÁY.
    return { ok: false, lyDo: `lượt đọc cục bộ hỏng: ${(e as Error)?.name ?? "lỗi không rõ"}` };
  }
}
