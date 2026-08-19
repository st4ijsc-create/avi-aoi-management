/**
 * ★★★ doc 79 · TRỤC 2 — **DANH SÁCH TRẮNG DỰ ÁN cho hộp cát repo (nhiều gốc).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN AN TOÀN SỐ MỘT: CLIENT GỬI **ID**, KHÔNG BAO GIỜ GỬI ĐƯỜNG DẪN GỐC.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hộp cát MỘT gốc (`gocHopCat()`) là một BẤT BIẾN của pha A/B/C. Trục 2 mở ra NHIỀU gốc, nhưng chỉ
 * từ một danh sách TRẮNG cấu hình (`AI_REPO_SANDBOX_ROOTS`). Client chọn một **id** trong danh sách;
 * server tra id ⇒ ra đường tuyệt đối. Nếu client gửi được ĐƯỜNG DẪN tự do thì toàn bộ hộp cát vô
 * nghĩa — nên **không có** hàm nào ở đây nhận đường dẫn từ client; chúng chỉ nhận `id`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐỌC ENV **TẠI CHỖ GỌI**, KHÔNG NHỚ ĐỆM Ở TẦNG MODULE — đúng nguyên tắc `gocHopCat()`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới lật env theo từng ca; một biến module đóng băng lúc nhập sẽ làm mọi ca sau chạy trên cấu
 * hình của ca đầu — đúng lớp "lưới xanh vì lý do sai". `danhSachDuAn()` phân tích LẠI mỗi lần gọi.
 * (Chỉ `daCanhBao` — bộ chống spam LOG — là trạng thái module; nó KHÔNG nhớ đệm KẾT QUẢ phân tích.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ FILE NÀY CHỈ DÙNG `fs.statSync` (XÁC THỰC), KHÔNG CHẠM BYTE.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `statSync` là **phép hỏi/dựng khung**, không chở nội dung tệp đi đâu — `programmingFileIo.census
 * .test.ts` (`API_CHO_BYTE`) cố ý KHÔNG tính nó là điểm chạm byte. Mọi lượt ĐỌC NỘI DUNG của một
 * gốc vẫn phải đi qua `readConfined()` như trước; file này chỉ trả lời "gốc này có tồn tại + là thư
 * mục không" khi NẠP danh sách.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * FORMAT `AI_REPO_SANDBOX_ROOTS` — **CHUỖI PHÂN TÁCH, KHÔNG JSON**, và đây là lý do:
 *   `id=Tên hiển thị|C:\đường\tuyệt\đối ; id2=Tên 2|D:\đường2 ; …`
 *     • mục ngăn bởi `;`  · id↔phần còn lại ngăn bởi `=` (DẤU ĐẦU TIÊN) · tên↔đường ngăn bởi `|`.
 *     • `|` tùy chọn: `id=đường` cũng hợp lệ (tên = id).
 *   Vì sao KHÔNG JSON: `.env` là một-dòng key=value và dotenv giữ NGUYÊN VĂN `\` trong giá trị
 *   không nháy — JSON đòi `C:\\SOURCES\\…` (escape đôi) rất dễ sai lặng. Chuỗi phân tách đọc thẳng
 *   được đường Windows `D:\SOURCES\avi-aoi-management` mà không escape.
 *   Vì sao ba dấu `; = |`: **không** xuất hiện trong đường Windows hay tên hiển thị tiếng Việt; còn
 *   `=` và `:` CÓ trong đường (`C:`) nên ta tách theo dấu `=`/`|` **ĐẦU TIÊN**, phần còn lại nguyên vẹn.
 *   id ràng buộc `[A-Za-z0-9_-]{1,64}` ⇒ ổn định, an toàn cho URL/JSON, và không nhầm với văn xuôi.
 */
import fs from "node:fs";
import path from "node:path";
import { gocHopCat } from "./repoSandbox";

/** Biến môi trường chứa danh sách TRẮNG các gốc dự án. VẮNG ⇒ một dự án mặc định = `gocHopCat()`. */
export const BIEN_DANH_SACH_GOC = "AI_REPO_SANDBOX_ROOTS";

/** Id của dự án mặc định (đường tương thích ngược khi `AI_REPO_SANDBOX_ROOTS` vắng). */
export const ID_DU_AN_MAC_DINH = "repo";

/** id ổn định: chữ/số/`_`/`-`, 1..64 ký tự. Cố ý HẸP để không nhầm với đường dẫn hay văn xuôi. */
const ID_HOP_LE = /^[A-Za-z0-9_-]{1,64}$/;

export interface DuAnHopCat {
  /** id ổn định — thứ DUY NHẤT client gửi lên. */
  id: string;
  /** Tên hiển thị (có thể tiếng Việt có dấu). */
  ten: string;
  /** Đường gốc TUYỆT ĐỐI đã xác thực (tồn tại + là thư mục) lúc nạp. */
  goc: string;
}

// Chống spam LOG (KHÔNG nhớ đệm kết quả phân tích — xem docblock đầu file).
const daCanhBao = new Set<string>();
function canhBao(msg: string): void {
  if (daCanhBao.has(msg)) return;
  daCanhBao.add(msg);
  console.warn(`[repoProjects] ${msg}`);
}

type MucPhanTich = DuAnHopCat | { loi: string };

/** Phân tích + XÁC THỰC một mục `id=Tên|đường`. Đường xấu ⇒ trả `{loi}`, KHÔNG ném. */
function phanTichMuc(raw: string): MucPhanTich {
  const s = raw.trim();
  if (s === "") return { loi: "mục rỗng" };

  const iEq = s.indexOf("=");
  if (iEq <= 0) return { loi: `thiếu '=' phân tách id: "${s}"` };
  const id = s.slice(0, iEq).trim();
  if (!ID_HOP_LE.test(id)) return { loi: `id không hợp lệ "${id}" (chỉ [A-Za-z0-9_-], 1..64)` };

  const conLai = s.slice(iEq + 1).trim();
  let ten = id;
  let duong = conLai;
  const iBar = conLai.indexOf("|");
  if (iBar >= 0) {
    ten = conLai.slice(0, iBar).trim() || id;
    duong = conLai.slice(iBar + 1).trim();
  }
  if (duong === "") return { loi: `mục "${id}" thiếu đường dẫn` };

  // ⚠ Xác thực: TUYỆT ĐỐI · TỒN TẠI · LÀ THƯ MỤC. Hỏng bất kỳ điều nào ⇒ bỏ mục (không sập danh sách).
  if (!path.isAbsolute(duong)) return { loi: `mục "${id}": đường dẫn KHÔNG tuyệt đối "${duong}"` };
  const abs = path.resolve(duong);
  let laThuMuc = false;
  try {
    laThuMuc = fs.statSync(abs).isDirectory();
  } catch {
    laThuMuc = false;
  }
  if (!laThuMuc) return { loi: `mục "${id}": không tồn tại hoặc không phải thư mục "${abs}"` };

  return { id, ten, goc: abs };
}

/** Dự án mặc định (tương thích ngược): một gốc = `gocHopCat()`. */
function duAnMacDinhTong(): DuAnHopCat {
  return { id: ID_DU_AN_MAC_DINH, ten: "Repo chính", goc: gocHopCat() };
}

/**
 * ★ Danh sách dự án hợp lệ. **Phân tích LẠI env mỗi lần gọi** (không nhớ đệm).
 *   • `AI_REPO_SANDBOX_ROOTS` VẮNG ⇒ MỘT dự án mặc định = `gocHopCat()` (đường cũ, không đổi).
 *   • Có mặt ⇒ chỉ các mục XÁC THỰC ĐƯỢC; mục xấu bị bỏ + log (không làm sập cả danh sách).
 *   • Có mặt nhưng KHÔNG mục nào hợp lệ ⇒ vẫn chạy được: rơi về dự án mặc định + log.
 */
export function danhSachDuAn(): DuAnHopCat[] {
  const raw = (process.env[BIEN_DANH_SACH_GOC] ?? "").trim();
  if (raw === "") return [duAnMacDinhTong()];

  const ra: DuAnHopCat[] = [];
  const thayId = new Set<string>();
  for (const muc of raw.split(";")) {
    if (muc.trim() === "") continue;
    const kq = phanTichMuc(muc);
    if ("loi" in kq) {
      canhBao(`bỏ mục — ${kq.loi}`);
      continue;
    }
    if (thayId.has(kq.id)) {
      canhBao(`bỏ mục id trùng "${kq.id}" (giữ mục đầu tiên)`);
      continue;
    }
    thayId.add(kq.id);
    ra.push(kq);
  }
  if (ra.length === 0) {
    canhBao(`${BIEN_DANH_SACH_GOC} có mặt nhưng KHÔNG mục nào hợp lệ — rơi về dự án mặc định (gocHopCat).`);
    return [duAnMacDinhTong()];
  }
  return ra;
}

/**
 * ★★★ Tra gốc TUYỆT ĐỐI theo id — **fail-closed**. id lạ / không phải chuỗi ⇒ `null`, KHÔNG rơi về
 * `gocHopCat()`. Đây là cửa DUY NHẤT biến một id (client gửi) thành một đường dẫn (server dùng).
 */
export function gocTheoId(id: unknown): string | null {
  if (typeof id !== "string" || id === "") return null;
  const m = danhSachDuAn().find((d) => d.id === id);
  return m ? m.goc : null;
}

/** Dự án mặc định để hiển thị/chọn ban đầu: ưu tiên id `"repo"`, nếu không có thì mục đầu. */
export function duAnMacDinh(): DuAnHopCat {
  const ds = danhSachDuAn();
  return ds.find((d) => d.id === ID_DU_AN_MAC_DINH) ?? ds[0]!;
}

/**
 * ★ Phân giải `projectId` (client gửi) → gốc, dùng ở CẢ tRPC lẫn chat.
 *   • VẮNG (`undefined`/`null`/`""`)  ⇒ `{ok:true, goc:null}` — KHÔNG ép gốc; người gọi để hộp cát
 *     dùng `gocHopCat()` (đường cũ, tương thích ngược cho client chưa gửi projectId).
 *   • id HỢP LỆ                       ⇒ `{ok:true, goc}`.
 *   • id LẠ / méo (kể cả client gửi ĐƯỜNG DẪN thay vì id) ⇒ `{ok:false, ma:"PROJECT_NOT_FOUND"}`
 *     — người gọi TỪ CHỐI, KHÔNG âm thầm đọc gốc mặc định.
 */
export type KetQuaPhanGiaiGoc =
  | { ok: true; id: string | null; goc: string | null }
  | { ok: false; ma: "PROJECT_NOT_FOUND" };

export function phanGiaiGoc(projectId: unknown): KetQuaPhanGiaiGoc {
  if (projectId === undefined || projectId === null || projectId === "") {
    return { ok: true, id: null, goc: null };
  }
  const goc = gocTheoId(projectId);
  if (goc === null) return { ok: false, ma: "PROJECT_NOT_FOUND" };
  return { ok: true, id: String(projectId), goc };
}
