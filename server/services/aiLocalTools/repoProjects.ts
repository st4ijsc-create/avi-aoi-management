/**
 * ★★★ doc 79 · TRỤC 2 — **DANH SÁCH TRẮNG DỰ ÁN cho hộp cát repo (nhiều gốc).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN AN TOÀN SỐ MỘT: CLIENT GỬI **ID**, KHÔNG BAO GIỜ GỬI ĐƯỜNG DẪN GỐC.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hộp cát MỘT gốc (`gocHopCat()`) là một BẤT BIẾN của pha A/B/C. Trục 2 mở ra NHIỀU gốc, nhưng chỉ
 * từ một danh sách TRẮNG cấu hình (`AI_REPO_SANDBOX_ROOTS`). Client chọn một **id** trong danh sách;
 * server tra id ⇒ ra đường tuyệt đối. Nếu client gửi được ĐƯỜNG DẪN tự do thì toàn bộ hộp cát vô
 * nghĩa — nên với mọi lượt **THỰC THI tool**, không có hàm nào ở đây nhận đường dẫn; chúng chỉ
 * nhận `id`.
 *
 * ⚠⚠ NGOẠI LỆ CÓ CHỦ ĐÍCH, ĐÚNG MỘT CHỖ (QUẢN LÝ DỰ ÁN 2026-08-23): `kiemTraDangKyDuAn()` nhận
 * một ĐƯỜNG DẪN — nhưng KHÔNG phải từ đường thực thi tool. Nó chỉ được gọi từ mutation ĐĂNG KÝ dự
 * án của **admin** (`repoWorkspace.themDuAn`, sàn `adminProcedure` + 2FA) — cùng mức tin cậy với
 * việc admin sửa tay `AI_REPO_SANDBOX_ROOTS` trong `.env`, và server xác thực FAIL-CLOSED (mỗi
 * lỗi một mã, xem `MA_TU_CHOI_DANG_KY`) trước khi một hàng chạm bảng `ai_repo_du_an` (mig 0337).
 * `gocTheoId`/`phanGiaiGoc` — hai cửa của đường thực thi — KHÔNG đổi một chữ ký nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐỌC ENV **TẠI CHỖ GỌI**, KHÔNG NHỚ ĐỆM Ở TẦNG MODULE — đúng nguyên tắc `gocHopCat()`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới lật env theo từng ca; một biến module đóng băng lúc nhập sẽ làm mọi ca sau chạy trên cấu
 * hình của ca đầu — đúng lớp "lưới xanh vì lý do sai". `danhSachDuAn()` phân tích LẠI mỗi lần gọi.
 *
 * ⚠⚠ TRẠNG THÁI MODULE NAY CÓ **HAI** MẢNH, và mảnh thứ hai là CÓ CHỦ ĐÍCH:
 *   • `daCanhBao` — bộ chống spam LOG (không nhớ đệm KẾT QUẢ phân tích, như cũ);
 *   • `boDemDuAnDb` — **ẢNH CHỤP** danh sách dự án nguồn DB. Vì sao phải là bộ đệm: `danhSachDuAn`/
 *     `gocTheoId`/`phanGiaiGoc` là SYNC và có NHIỀU điểm gọi sync (CLI, MCP, cauNoiCli,
 *     aiLocalKnowledgeService) — đổi chúng thành async là đổi chữ ký lan khắp repo. Nên: nguồn DB
 *     được nạp BẤT ĐỒNG BỘ qua `napLaiDuAnTuDb()` (gọi lúc server boot + sau MỖI mutation
 *     thêm/xoá), còn các hàm sync chỉ ĐỌC ảnh chụp. Hệ quả phải nói thành lời: một tiến trình
 *     KHÁC (CLI/MCP chạy riêng) thấy dự án DB theo ảnh chụp NÓ nạp lúc NÓ khởi động — thêm dự án
 *     qua UI web sẽ KHÔNG hiện trong một phiên CLI đang mở sẵn (chấp nhận được: mở phiên CLI mới).
 *     Riêng phần ENV vẫn được phân tích lại mỗi lần gọi, không đổi.
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
  /**
   * Nguồn của mục — client (màn Quản lý dự án của admin) cần biết mục nào xoá được:
   *   • `"env"` — từ `AI_REPO_SANDBOX_ROOTS` (hoặc dự án mặc định): KHÔNG xoá được qua UI;
   *   • `"db"`  — đăng ký qua UI (bảng `ai_repo_du_an`): xoá được qua `repoWorkspace.xoaDuAn`.
   */
  nguon: "env" | "db";
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

  return { id, ten, goc: abs, nguon: "env" };
}

/** Dự án mặc định (tương thích ngược): một gốc = `gocHopCat()`. */
function duAnMacDinhTong(): DuAnHopCat {
  return { id: ID_DU_AN_MAC_DINH, ten: "Repo chính", goc: gocHopCat(), nguon: "env" };
}

/**
 * ★★★ ẢNH CHỤP dự án nguồn DB (bảng `ai_repo_du_an`, mig 0337). NGƯỜI GHI DUY NHẤT là
 * `napLaiDuAnTuDb()` — gọi lúc server boot và sau mỗi mutation thêm/xoá. Đọc khối "TRẠNG THÁI
 * MODULE NAY CÓ HAI MẢNH" ở đầu file trước khi thêm một người ghi thứ hai.
 */
let boDemDuAnDb: DuAnHopCat[] = [];

/** Phần ENV của danh sách (phân tích LẠI mỗi lần gọi — nguyên hành vi doc 79, không đổi). */
function danhSachDuAnEnv(): DuAnHopCat[] {
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
 * ★ Danh sách dự án hợp lệ = **ENV (phân tích lại mỗi lần) + ẢNH CHỤP DB**, và env THẮNG:
 *   • `AI_REPO_SANDBOX_ROOTS` VẮNG ⇒ dự án mặc định (`gocHopCat()`) + các mục DB.
 *   • Trùng `id` giữa DB và env ⇒ mục DB bị BỎ (env là cấu hình tay của người vận hành — nó phải
 *     thắng thứ đăng ký qua UI; lượt đăng ký trùng id vốn đã bị `kiemTraDangKyDuAn` chặn, nhánh
 *     này chỉ đỡ ca "env đổi SAU khi DB đã có hàng").
 *   • Mục DB có gốc đã BIẾN MẤT trên đĩa ⇒ bỏ + log (đúng luật mục env xấu: không sập danh sách).
 *     `statSync` mỗi lần gọi — cùng chi phí và cùng lý do với phần env (gốc trên đĩa là sự thật
 *     sống, ảnh chụp chỉ là danh mục).
 */
export function danhSachDuAn(): DuAnHopCat[] {
  const ra = danhSachDuAnEnv();
  const thayId = new Set(ra.map((d) => d.id));
  for (const m of boDemDuAnDb) {
    if (thayId.has(m.id)) {
      canhBao(`bỏ mục DB id trùng env "${m.id}" (env thắng)`);
      continue;
    }
    let laThuMuc = false;
    try {
      laThuMuc = fs.statSync(m.goc).isDirectory();
    } catch {
      laThuMuc = false;
    }
    if (!laThuMuc) {
      canhBao(`bỏ mục DB "${m.id}" — gốc không còn là thư mục: "${m.goc}"`);
      continue;
    }
    thayId.add(m.id);
    ra.push(m);
  }
  return ra;
}

/**
 * ★★★ Nạp lại ẢNH CHỤP dự án nguồn DB — **người ghi DUY NHẤT của `boDemDuAnDb`**.
 *
 * Gọi ở: (1) server boot (`server/_core/index.ts`) — để selectBox thấy dự án DB ngay lượt hỏi đầu;
 * (2) sau MỖI mutation `themDuAn`/`xoaDuAn` — để `danhSachDuAn()` (sync) thấy thay đổi KHÔNG cần
 * restart. Mỗi hàng được XÁC THỰC LẠI lúc nạp (id đúng khuôn · gốc tuyệt đối · là thư mục) — một
 * hàng bị đầu độc bằng SQL thẳng vẫn không mở được một gốc không tồn tại.
 *
 * ⚠ FAIL-SAFE, không ném: DB vắng / bảng chưa migrate ⇒ GIỮ ảnh chụp hiện có và khai `ok:false`.
 *   Tiến trình CLI/MCP offline (doc 83) đi đúng lối này — nó chạy tiếp với danh sách env thuần.
 * ⚠ Import ĐỘNG tầng dữ liệu: file này nằm trong đồ thị import của CLI standalone; một import tĩnh
 *   `server/db/connection` sẽ kéo cấu hình DB vào một tiến trình cố ý không có DB.
 */
export async function napLaiDuAnTuDb(): Promise<{ ok: boolean; soMuc: number }> {
  try {
    const { danhSachDuAnDb } = await import("../../db/aiRepoDuAn");
    const rows = await danhSachDuAnDb();
    const moi: DuAnHopCat[] = [];
    const thayId = new Set<string>();
    for (const r of rows) {
      if (!ID_HOP_LE.test(r.id) || thayId.has(r.id)) {
        canhBao(`bỏ hàng DB id xấu/trùng "${r.id}"`);
        continue;
      }
      if (typeof r.goc !== "string" || !path.isAbsolute(r.goc)) {
        canhBao(`bỏ hàng DB "${r.id}" — gốc không tuyệt đối`);
        continue;
      }
      let laThuMuc = false;
      try {
        laThuMuc = fs.statSync(r.goc).isDirectory();
      } catch {
        laThuMuc = false;
      }
      if (!laThuMuc) {
        canhBao(`bỏ hàng DB "${r.id}" — gốc không tồn tại/không phải thư mục: "${r.goc}"`);
        continue;
      }
      thayId.add(r.id);
      moi.push({ id: r.id, ten: r.ten, goc: path.resolve(r.goc), nguon: "db" });
    }
    boDemDuAnDb = moi;
    return { ok: true, soMuc: moi.length };
  } catch (err) {
    canhBao(`napLaiDuAnTuDb hỏng (giữ ảnh chụp cũ): ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, soMuc: boDemDuAnDb.length };
  }
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — PHÁN QUYẾT ĐĂNG KÝ/XOÁ, FAIL-CLOSED, MỖI LỖI MỘT MÃ.
// Đây là NGOẠI LỆ CÓ CHỦ ĐÍCH duy nhất nhận đường dẫn — đọc khối ⚠⚠ ở đầu file trước khi thêm
// người gọi mới: người gọi HỢP LỆ duy nhất là mutation admin `repoWorkspace.themDuAn`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Trần số dự án nguồn DB — chống một admin biến selectBox thành danh bạ ổ đĩa. */
export const TRAN_DU_AN_DB = 20;

/**
 * Đoạn đường CẤM ở BẤT KỲ vị trí nào trong gốc đăng ký: một dự án trỏ vào `node_modules`/`.git`/
 * `dist` không phải mã nguồn của ai — nó là một hộp cát vô nghĩa nhưng vẫn tốn ngân sách đọc.
 */
export const DOAN_DUONG_CAM = ["node_modules", ".git", "dist"] as const;

/**
 * Mã từ chối đăng ký — MỖI mệnh đề hỏng một mã, để client nói được "phải làm gì" thay vì một câu
 * "không hợp lệ" chung chung (khuôn thông điệp lỗi của repo: nói rõ việc cần làm).
 */
export type MaTuChoiDangKy =
  | "ID_KHONG_HOP_LE" // id không khớp [A-Za-z0-9_-]{1,64}
  | "TEN_KHONG_HOP_LE" // tên rỗng/quá 100 ký tự/chứa #;=| (bài học dotenv — mục DB còn xuất ngược ra env được)
  | "TRUNG_ID" // id đã có (env HOẶC db) — env không bị che, db không bị ghi đè
  | "DUONG_DAN_KHONG_TUYET_DOI" // đường tương đối — server không đoán "tương đối so với đâu"
  | "DUONG_DAN_KHONG_TON_TAI" // realpathSync thất bại — thư mục phải CÓ THẬT trước khi đăng ký
  | "KHONG_PHAI_THU_MUC" // trỏ vào một TỆP — gốc hộp cát phải là thư mục
  | "THU_MUC_CAM" // một đoạn đường là node_modules/.git/dist
  | "NAM_TRONG_GOC_DA_CO" // nằm TRONG (hoặc trùng) một gốc đã có — hai hộp cát chồng lấn
  | "CHUA_GOC_DA_CO" // CHỨA một gốc đã có — chiều ngược của cùng lỗi chồng lấn
  | "VUOT_TRAN_DU_AN"; // đã đủ TRAN_DU_AN_DB mục nguồn DB

export type KetQuaDangKy =
  | { ok: true; id: string; ten: string; goc: string }
  | { ok: false; ma: MaTuChoiDangKy };

/**
 * `con` nằm TRONG (hoặc TRÙNG) `cha`?  So bằng `path.relative` — trên win32 phép so của Node đã
 * không phân biệt hoa thường, đúng hệ tệp Windows. `rel === ".."` và `rel` bắt đầu `..` + sep là
 * ra ngoài; mọi hình dạng còn lại (kể cả thư mục tên `..foo`) là ở trong.
 */
function namTrong(con: string, cha: string): boolean {
  const rel = path.relative(cha, con);
  if (rel === "") return true; // trùng nhau
  if (path.isAbsolute(rel)) return false; // khác ổ đĩa
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/**
 * ★★★ PHÁN QUYẾT ĐĂNG KÝ một dự án mới — FAIL-CLOSED: mọi đường không chứng minh được là hợp lệ
 * đều bị TỪ CHỐI kèm đúng MỘT mã. Thứ tự kiểm: rẻ trước (hình dạng chuỗi), đắt sau (hệ tệp), và
 * TRẦN sau cùng (để "vượt trần" không che một lỗi thật của chính mục đang đăng ký).
 *
 * ⚠ Gốc trả về là **`realpathSync`** — mọi symlink/junction đã được phân giải TRƯỚC khi so lồng
 *   nhau; một junction trỏ vào trong repo không đăng ký được thành "dự án ngoài repo".
 * ⚠ So lồng nhau chạy trên `danhSachDuAn()` SỐNG (env + ảnh chụp DB) **cộng `gocHopCat()`** tường
 *   minh: khi env vắng, gốc hộp cát mặc định vẫn phải được bảo vệ khỏi chồng lấn.
 * ⚠ Trần đếm trên ẢNH CHỤP (`boDemDuAnDb`) — cùng ngữ nghĩa snapshot đã khai ở đầu file; router
 *   nạp lại ảnh chụp sau mỗi mutation nên con số này chỉ lệch trong cửa sổ hai admin bấm cùng lúc,
 *   và lệch tối đa 1 (chấp nhận được cho một trần chống-bừa-bộn, không phải trần an ninh).
 */
export function kiemTraDangKyDuAn(input: {
  id: unknown;
  ten: unknown;
  duongDan: unknown;
}): KetQuaDangKy {
  // 1. id — đúng khuôn danh sách trắng (cùng regex với env và CHECK 0337).
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!ID_HOP_LE.test(id)) return { ok: false, ma: "ID_KHONG_HOP_LE" };

  // 2. tên — 1..100 ký tự, cấm #;=| (để một mục DB còn xuất ngược ra dòng env mà không đổi nghĩa).
  const ten = typeof input.ten === "string" ? input.ten.trim() : "";
  if (ten.length < 1 || ten.length > 100 || /[#;=|]/.test(ten)) {
    return { ok: false, ma: "TEN_KHONG_HOP_LE" };
  }

  // 3. id trùng — env HOẶC db. Kiểm TRƯỚC phần hệ tệp: mã lỗi này người dùng sửa được ngay.
  const danhSach = danhSachDuAn();
  if (danhSach.some((d) => d.id === id)) return { ok: false, ma: "TRUNG_ID" };

  // 4. đường dẫn — TUYỆT ĐỐI, realpath TỒN TẠI, LÀ THƯ MỤC.
  const duong = typeof input.duongDan === "string" ? input.duongDan.trim() : "";
  if (duong === "" || !path.isAbsolute(duong)) {
    return { ok: false, ma: "DUONG_DAN_KHONG_TUYET_DOI" };
  }
  let goc: string;
  try {
    goc = fs.realpathSync(duong);
  } catch {
    return { ok: false, ma: "DUONG_DAN_KHONG_TON_TAI" };
  }
  let laThuMuc = false;
  try {
    laThuMuc = fs.statSync(goc).isDirectory();
  } catch {
    laThuMuc = false;
  }
  if (!laThuMuc) return { ok: false, ma: "KHONG_PHAI_THU_MUC" };

  // 5. đoạn đường cấm — ở BẤT KỲ vị trí nào (so không phân biệt hoa thường, đúng hệ tệp Windows).
  const doan = goc.split(/[\\/]+/).map((s) => s.toLowerCase());
  if (DOAN_DUONG_CAM.some((cam) => doan.includes(cam))) {
    return { ok: false, ma: "THU_MUC_CAM" };
  }

  // 6. KHÔNG lồng gốc đã có — cả hai chiều. Hai dự án lồng nhau = hai hộp cát chồng lấn: cùng một
  //    tệp được hai chính sách phán, và ngân sách đọc của dự án này tiêu hộ dự án kia.
  const gocDaCo = [...danhSach.map((d) => d.goc), gocHopCat()];
  for (const cu of gocDaCo) {
    if (namTrong(goc, cu)) return { ok: false, ma: "NAM_TRONG_GOC_DA_CO" };
    if (namTrong(cu, goc)) return { ok: false, ma: "CHUA_GOC_DA_CO" };
  }

  // 7. trần số mục nguồn DB.
  if (boDemDuAnDb.length >= TRAN_DU_AN_DB) return { ok: false, ma: "VUOT_TRAN_DU_AN" };

  return { ok: true, id, ten, goc };
}

/** Mã từ chối xoá — mục env KHÔNG xoá được qua UI (env chỉ sửa được bằng tay, đúng thiết kế). */
export type MaTuChoiXoa = "MUC_ENV_KHONG_XOA_DUOC" | "KHONG_TIM_THAY";

/**
 * ★ PHÁN QUYẾT XOÁ: chỉ mục **nguồn DB** xoá được.
 *
 * ⚠ So với phần **ENV SỐNG** (`danhSachDuAnEnv()`), KHÔNG so với danh sách hợp nhất — có chủ đích:
 *   một hàng DB có gốc đã BIẾN MẤT trên đĩa bị lọc khỏi `danhSachDuAn()`, và nếu phán quyết xoá
 *   nhìn danh sách hợp nhất thì hàng ấy thành **mồ côi vĩnh viễn** (không hiện để chọn ⇒ không xoá
 *   được ⇒ chiếm một suất trần mãi mãi). Ở đây chỉ chặn đúng thứ phải chặn (mục env, kể cả dự án
 *   mặc định); hàng có TỒN TẠI trong bảng hay không do lượt DELETE của tầng dữ liệu phán — xoá 0
 *   hàng ⇒ router trả `KHONG_TIM_THAY`.
 */
export function kiemTraXoaDuAn(id: unknown): { ok: true; id: string } | { ok: false; ma: MaTuChoiXoa } {
  if (typeof id !== "string" || !ID_HOP_LE.test(id)) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (danhSachDuAnEnv().some((d) => d.id === id)) {
    return { ok: false, ma: "MUC_ENV_KHONG_XOA_DUOC" };
  }
  return { ok: true, id };
}
