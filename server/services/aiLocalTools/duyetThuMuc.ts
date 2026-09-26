/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — BỘ DUYỆT THƯ MỤC MÁY CHỦ cho form đăng ký dự án.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỒN TẠI — VÀ VÌ SAO NÓ **KHÔNG PHẢI** MỘT HÀNG RÀO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trình duyệt không duyệt được đĩa MÁY CHỦ, nên admin trước nay phải GÕ TAY một đường tuyệt đối
 * vào form đăng ký (`repoWorkspace.themDuAn`) — và chủ dự án đã gõ sai thật. Bộ duyệt này chỉ thay
 * lượt gõ tay bằng lượt bấm-để-chọn: **cùng người** (admin đã 2FA, sàn `adminProcedure` +
 * `moduleGate("MOD_AI")` — đúng sàn của `themDuAn`), **cùng mức tin cậy** với việc admin sửa tay
 * `AI_REPO_SANDBOX_ROOTS` trong `.env`.
 *
 * ⚠⚠ Nó KHÔNG mở nội dung tệp: trả về **CHỈ TÊN THƯ MỤC CON MỘT CẤP** — không tệp, không kích
 *    thước, không byte nào (`readdirSync` + `withFileTypes`, lọc `isDirectory()`; cùng lý lẽ
 *    "statSync là phép hỏi, không chở byte" của `repoProjects.ts`).
 * ⚠⚠ Mọi đường dẫn CHỌN xong vẫn đi qua `kiemTraDangKyDuAn` FAIL-CLOSED lúc đăng ký — bộ duyệt
 *    không phải hàng rào, hàng rào vẫn ở chỗ cũ. Đừng "tối ưu" bằng cách bỏ kiểm ở `themDuAn` vì
 *    "đường đã qua bộ duyệt": client sửa tay ô đường dẫn vẫn là đường HỢP LỆ của form.
 * ⚠ KHÔNG cache, KHÔNG ghi gì: mỗi lượt gọi đọc hệ tệp SỐNG (thư mục trên đĩa là sự thật sống,
 *   cùng nguyên tắc `danhSachDuAn()` stat lại mỗi lần).
 *
 * FAIL-CLOSED từng bước, một mã duy nhất `DUONG_KHONG_HOP_LE` — với NGƯỜI DÙNG mọi ca (tương đối /
 * không tồn tại / là tệp / hệ điều hành chặn đọc) cùng một việc phải làm: quay lại một cấp hoặc
 * chọn chỗ khác; tách mã chỉ tăng bề mặt dịch mà không đổi hành động.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Trần số mục trả về MỖI CẤP — chống một thư mục 100k con (node_modules của ai đó) làm phình
 * payload. Xuất thành hằng để lưới đo ĐÚNG con số và client hiện con số CỦA SERVER, không tự đoán.
 */
export const TRAN_MUC_MOI_CAP = 500;

/** Mã từ chối duyệt — xem docblock đầu file vì sao chỉ MỘT mã. */
export type MaTuChoiDuyet = "DUONG_KHONG_HOP_LE";

export interface MucThuMucCon {
  /** Tên hiển thị (tên thư mục, hoặc "C:\" cho ổ đĩa). */
  ten: string;
  /** Đường tuyệt đối để lượt duyệt kế tiếp gửi lại nguyên văn. */
  duong: string;
}

export type KetQuaDuyetThuMuc =
  | {
      ok: true;
      /** Đường đang xem (đã `realpathSync`), hoặc `null` ⇔ đang ở danh sách ổ đĩa. */
      duongHienTai: string | null;
      /** Đường cho nút "lên một cấp"; `null` ⇔ cấp trên là danh sách ổ đĩa. */
      duongCha: string | null;
      muc: MucThuMucCon[];
      /** true ⇔ thư mục có NHIỀU HƠN `tran` con — danh sách đã bị cắt. */
      biCat: boolean;
      /** = `TRAN_MUC_MOI_CAP` — client hiện con số của server, không gán cứng 500 phía client. */
      tran: number;
    }
  | { ok: false; ma: MaTuChoiDuyet };

/**
 * ★ THUẦN — áp trần lên một danh sách ĐÃ SẮP XẾP. Tách khỏi phần fs để lưới đo logic cắt bằng
 * bảng giả (501 phần tử) mà không phải dựng 501 thư mục thật trong ca đơn vị; ca tRPC vẫn dựng
 * thư mục thật để đo cả đường (xem `quanLyDuAnRepo.test.ts` §5).
 */
export function apDungTranMuc<T>(muc: readonly T[], tran: number = TRAN_MUC_MOI_CAP): { muc: T[]; biCat: boolean } {
  if (muc.length <= tran) return { muc: [...muc], biCat: false };
  return { muc: muc.slice(0, tran), biCat: true };
}

/**
 * Danh sách ổ đĩa. Windows: thử `A:\`..`Z:\` bằng `fs.existsSync` — rẻ, không WMI, không tiến
 * trình con. Ngoài Windows (CI Linux tương lai): gốc duy nhất là `/`.
 */
function danhSachODia(): MucThuMucCon[] {
  if (process.platform !== "win32") return [{ ten: "/", duong: "/" }];
  const ra: MucThuMucCon[] = [];
  for (let i = 65; i <= 90; i++) {
    const oDia = `${String.fromCharCode(i)}:\\`;
    try {
      if (fs.existsSync(oDia)) ra.push({ ten: oDia, duong: oDia });
    } catch {
      // Một ổ tháo rời đang hỏng không được làm sập cả danh sách.
    }
  }
  return ra;
}

/**
 * ★★★ DUYỆT MỘT CẤP. `duong` VẮNG/rỗng ⇒ danh sách ổ đĩa; có ⇒ thư mục con TRỰC TIẾP của nó.
 *
 * Fail-closed theo đúng thứ tự rẻ→đắt: là chuỗi tuyệt đối → `realpathSync` tồn tại (symlink/
 * junction được phân giải TRƯỚC khi liệt kê) → là thư mục → đọc được. Mục con lỗi (EPERM — thư
 * mục hệ thống Windows rất nhiều) bị BỎ QUA từng mục, không làm sập cả cấp.
 */
export function duyetThuMucServer(duong?: unknown): KetQuaDuyetThuMuc {
  if (duong === undefined || duong === null || (typeof duong === "string" && duong.trim() === "")) {
    return { ok: true, duongHienTai: null, duongCha: null, muc: danhSachODia(), biCat: false, tran: TRAN_MUC_MOI_CAP };
  }
  if (typeof duong !== "string" || !path.isAbsolute(duong.trim())) {
    return { ok: false, ma: "DUONG_KHONG_HOP_LE" };
  }
  let goc: string;
  try {
    goc = fs.realpathSync(duong.trim());
  } catch {
    return { ok: false, ma: "DUONG_KHONG_HOP_LE" };
  }
  let laThuMuc = false;
  try {
    laThuMuc = fs.statSync(goc).isDirectory();
  } catch {
    laThuMuc = false;
  }
  if (!laThuMuc) return { ok: false, ma: "DUONG_KHONG_HOP_LE" };

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(goc, { withFileTypes: true });
  } catch {
    // EPERM trên CHÍNH thư mục (System Volume Information…) — từ chối rõ, không ném thô.
    return { ok: false, ma: "DUONG_KHONG_HOP_LE" };
  }

  const ten: string[] = [];
  for (const d of dirents) {
    try {
      if (d.isDirectory()) {
        ten.push(d.name);
      } else if (d.isSymbolicLink()) {
        // Junction/symlink trỏ vào thư mục (máy dev Windows hay có) — theo được thì theo,
        // stat lỗi thì BỎ MỤC ĐÓ, không bỏ cả cấp.
        if (fs.statSync(path.join(goc, d.name)).isDirectory()) ten.push(d.name);
      }
    } catch {
      // bỏ qua mục đọc-lỗi
    }
  }
  ten.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }));
  const cat = apDungTranMuc(ten);
  const cha = path.dirname(goc);
  return {
    ok: true,
    duongHienTai: goc,
    duongCha: cha === goc ? null : cha,
    muc: cat.muc.map((t) => ({ ten: t, duong: path.join(goc, t) })),
    biCat: cat.biCat,
    tran: TRAN_MUC_MOI_CAP,
  };
}
