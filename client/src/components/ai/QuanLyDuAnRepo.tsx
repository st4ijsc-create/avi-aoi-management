/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — nút bánh răng + dialog cạnh selectBox dự án của
 * `AICodingWorkspace`: admin thêm/xoá thư mục dự án QUA UI, không phải sửa tay `.env` + restart.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA ĐIỀU KHÔNG ĐỔI — đọc trước khi sửa
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Bất biến trục 2 giữ nguyên cho mọi lượt THỰC THI tool**: cây tệp/đọc tệp/grep/chat vẫn
 *      chỉ gửi `projectId`. Đường dẫn xuất hiện đúng MỘT chỗ: form ĐĂNG KÝ trong dialog này —
 *      mutation admin (`repoWorkspace.themDuAn`, sàn `adminProcedure` + 2FA), cùng mức tin cậy
 *      với admin sửa `.env`, và server xác thực FAIL-CLOSED (mỗi lỗi một mã). (Bộ chọn thư mục
 *      `duyetThuMuc` cũng nhận một đường — nhưng nó CHỈ liệt kê tên thư mục cho form, cùng sàn
 *      admin+2FA, và đường chọn xong vẫn qua `kiemTraDangKyDuAn` lúc đăng ký.)
 *   2. **Client ẩn nút chỉ là phép lịch sự** — trang chỉ gắn component này cho `role === "admin"`,
 *      nhưng hàng rào THẬT là `adminProcedure` ở server: gọi thẳng API bằng tài khoản thường vẫn
 *      nhận FORBIDDEN.
 *   3. **Mục nguồn env KHÔNG xoá được** — server từ chối (`MUC_ENV_KHONG_XOA_DUOC`); UI hiện ổ
 *      khoá thay nút xoá để người dùng không bấm vào một cánh cửa đóng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ SỬA 2026-08-23 (chủ dự án dùng THẬT và bị chặn với thông điệp NÓI DỐI) — BA LUẬT MỚI, đo ở
 * `quanLyDuAnRepo.unit.test.ts` §6–§8:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • **KHÔNG nuốt lỗi thật.** `onError` cũ vứt `e` và khai `LUU_THAT_BAI` ("CSDL từ chối…") cho
 *     MỌI lỗi vận chuyển — admin chưa bật 2FA đọc một câu BỊA về CSDL trong khi câu server
 *     ("…bật xác thực 2 bước…Vào Cài đặt > Bảo mật…") mới chỉ dẫn được việc. Nay: FORBIDDEN/
 *     UNAUTHORIZED ⇒ hiện NGUYÊN VĂN câu server; mã khác ⇒ câu chung + `e.message` trong chi tiết.
 *   • **Query hỏng KHÔNG BAO GIỜ vẽ "Chưa có dự án nào."** — danh-sách-rỗng là một LỜI KHAI
 *     ("không có dữ liệu"), query bị từ chối là một sự cố; vẽ cái trước cho cái sau là nói dối.
 *     Nay `isError` ⇒ băng lỗi mang đúng thông điệp server (nổi bật nếu là câu 2FA).
 *   • **Kiểm ID ngay khi gõ** (khuôn `RE_ID_DU_AN` dùng CHUNG với server qua `@shared`): sai thì
 *     câu đỏ NGAY dưới ô + nút Thêm khoá — "Dự án demo" (dấu cách, dấu tiếng Việt) phải bị bắt
 *     TRƯỚC khi tốn một vòng server.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH TỆP + XUẤT KHẨU RUỘT — cùng lý do `BoChonPhien` (đọc docblock tệp ấy): Radix
 * `Dialog` đi qua Portal, một lưới `renderToStaticMarkup` dựng vỏ sẽ KHÔNG BAO GIỜ thấy nội dung
 * bên trong — xanh hay đỏ đều vì lý do sai. Nên ruột (`NoiDungQuanLyDuAn`) + phép dịch mã lỗi
 * (`cauChoMaLoi`) + các hàm thuần (`slugTuTenThuMuc`/`tenThuMucCuoi`/`docLoiTrpc`) được xuất khẩu
 * cho lưới dựng thẳng cây thật; `QuanLyDuAnRepo` chỉ là vỏ: nút bánh răng + dây nối tRPC.
 *
 * ⚠ SAU MỖI thêm/xoá thành công: invalidate CẢ `danhSachDayDu` (danh sách trong dialog) LẪN
 *   `listProjects` (selectBox của trang) — selectBox có mục mới NGAY, không cần F5. Server đã
 *   `napLaiDuAnTuDb()` trong chính mutation nên lượt refetch đọc được ảnh chụp mới.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Folder, FolderPlus, FolderSearch, Loader2, Lock, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RE_ID_DU_AN } from "@shared/aiCodingSession";

/** Một mục như `repoWorkspace.danhSachDayDu` trả về. */
export interface MucDuAnUI {
  id: string;
  ten: string;
  goc: string;
  nguon: "env" | "db";
  /** false ⇔ hàng DB có gốc đã biến mất trên đĩa hoặc bị mục env trùng id che — vẫn xoá được. */
  hoatDong: boolean;
}

/** Hình dạng `t` khai hẹp — để lưới đơn vị truyền một `t` giả tra thẳng `vi.json` (khuôn BoChonPhien). */
type HamDich = (khoa: string, macDinh: string, tham?: Record<string, unknown>) => string;

/**
 * ★★★ MỖI MÃ TỪ CHỐI CỦA SERVER → MỘT CÂU NÓI RÕ PHẢI LÀM GÌ. Thuần, không state — lưới đơn vị
 * đối chiếu từng mã với từ điển ba locale. Mã lạ (server mới hơn client) rơi về câu chung + mã thô
 * để người dùng còn báo được lỗi thay vì nhìn một chuỗi rỗng.
 */
export function cauChoMaLoi(ma: string, t: HamDich): string {
  switch (ma) {
    case "ID_KHONG_HOP_LE":
      return t("repoWs.duan.err.idKhongHopLe", "ID chỉ được chứa chữ không dấu, số, gạch dưới, gạch nối (1–64 ký tự). Ví dụ: du-an-moi");
    case "TEN_KHONG_HOP_LE":
      return t("repoWs.duan.err.tenKhongHopLe", "Tên phải có 1–100 ký tự và không chứa các ký tự # ; = | — hãy bỏ chúng khỏi tên.");
    case "TRUNG_ID":
      return t("repoWs.duan.err.trungId", "ID này đã tồn tại (trong .env hoặc đã đăng ký). Chọn một ID khác.");
    case "DUONG_DAN_KHONG_TUYET_DOI":
      return t("repoWs.duan.err.khongTuyetDoi", "Đường dẫn phải là đường TUYỆT ĐỐI trên máy chủ (ví dụ D:\\DuAn\\ten-du-an), không phải đường tương đối.");
    case "DUONG_DAN_KHONG_TON_TAI":
      return t("repoWs.duan.err.khongTonTai", "Thư mục này không tồn tại trên máy chủ. Tạo thư mục trước, rồi đăng ký lại.");
    case "KHONG_PHAI_THU_MUC":
      return t("repoWs.duan.err.khongPhaiThuMuc", "Đường dẫn trỏ vào một TỆP. Hãy trỏ vào THƯ MỤC gốc của dự án.");
    case "THU_MUC_CAM":
      return t("repoWs.duan.err.thuMucCam", "Không đăng ký được thư mục nằm trong node_modules, .git hoặc dist. Chọn thư mục mã nguồn thật.");
    case "NAM_TRONG_GOC_DA_CO":
      return t("repoWs.duan.err.namTrongGocDaCo", "Thư mục này nằm TRONG (hoặc trùng) một dự án đã có — hai hộp cát sẽ chồng lấn. Chọn thư mục ngoài các dự án hiện có.");
    case "CHUA_GOC_DA_CO":
      return t("repoWs.duan.err.chuaGocDaCo", "Thư mục này CHỨA một dự án đã có — hai hộp cát sẽ chồng lấn. Chọn thư mục hẹp hơn, không bao trùm dự án khác.");
    case "VUOT_TRAN_DU_AN":
      return t("repoWs.duan.err.vuotTran", "Đã đạt trần số dự án đăng ký qua UI. Xoá bớt một dự án không còn dùng rồi thêm lại.");
    case "LUU_THAT_BAI":
      return t("repoWs.duan.err.luuThatBai", "Không lưu được (CSDL từ chối — có thể một admin khác vừa thêm cùng ID). Tải lại danh sách rồi thử lại.");
    case "MUC_ENV_KHONG_XOA_DUOC":
      return t("repoWs.duan.err.mucEnv", "Mục này khai trong .env của máy chủ — chỉ sửa được bằng tay trong .env, không xoá được ở đây.");
    case "KHONG_TIM_THAY":
      return t("repoWs.duan.err.khongTimThay", "Không thấy dự án này nữa (có thể đã bị xoá). Tải lại danh sách.");
    case "DUONG_KHONG_HOP_LE":
      return t("repoWs.duan.err.duongKhongHopLe", "Không duyệt được đường này (không tồn tại, không phải thư mục, hoặc hệ điều hành chặn đọc). Lên một cấp hoặc chọn ổ đĩa khác.");
    default:
      return t("repoWs.duan.err.khac", "Server từ chối với mã {{ma}} — báo cho người phụ trách hệ thống.", { ma });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HÀM THUẦN — xuất khẩu để lưới đo bằng oracle, không qua render
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ THUẦN — slug hoá tên thư mục thành một ID hợp khuôn `[A-Za-z0-9_-]{1,64}`: bỏ dấu tiếng Việt
 * (NFD + lột dấu tổ hợp, riêng đ/Đ không phân rã nên thay tay), thường hoá, khoảng trắng→`-`,
 * lọc ký tự ngoài khuôn, gộp `-` liên tiếp, cắt 64, tỉa `-` hai đầu.
 * Oracle: "Dự án demo"→"du-an-demo" · "Đường Ống 2026!"→"duong-ong-2026" · toàn ký tự lạ→"".
 */
export function slugTuTenThuMuc(ten: string): string {
  return ten
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
}

/** ★ THUẦN — đoạn CUỐI của một đường dẫn, cả Windows lẫn POSIX: "D:\\DuAn\\Ống" → "Ống"; "C:\\" → "C:". */
export function tenThuMucCuoi(duong: string): string {
  const doan = duong.split(/[\\/]+/).filter((s) => s !== "");
  return doan.length > 0 ? doan[doan.length - 1]! : duong;
}

/**
 * ★★★ THUẦN — đọc một TRPCClientError(-like) thành `{code, cau, la2fa}` để client HẾT nuốt lỗi
 * thật (bài học 2026-08-23: `onError` cũ vứt `e` rồi khai "CSDL từ chối" — bịa; câu 2FA của
 * server mới là câu chỉ dẫn được việc). Hình dạng đo từ repo: `e.data?.code` = mã tRPC
 * ("FORBIDDEN"/"UNAUTHORIZED"/…), `e.message` = câu server (câu 2FA của `adminProcedure` nằm ở
 * đây), `e.data?.appCode === "TWO_FACTOR_NOT_SET_UP"` = tín hiệu 2FA máy-đọc-được (errorFormatter
 * chuyển lên khi APP_ERROR_CODES_ENABLED bật — mặc định bật) kèm lưới chữ dự phòng khi cờ tắt.
 */
export function docLoiTrpc(e: unknown): { code: string | null; cau: string; la2fa: boolean } {
  const data = (e as { data?: { code?: unknown; appCode?: unknown } } | null | undefined)?.data;
  const code = typeof data?.code === "string" ? data.code : null;
  const msg = (e as { message?: unknown } | null | undefined)?.message;
  const cau = typeof msg === "string" ? msg : "";
  const la2fa = data?.appCode === "TWO_FACTOR_NOT_SET_UP" || /xác thực 2 bước|\b2fa\b/i.test(cau);
  return { code, cau, la2fa };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HÌNH DẠNG PROPS — ruột THUẦN, mọi dây tRPC ở vỏ
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Lỗi của LƯỢT THÊM gần nhất — ba nguồn sự thật, KHÔNG trộn vào nhau. */
export type LoiThemUI =
  /** Server trả `{ok:false, ma}` (phán quyết nghiệp vụ) — dịch qua `cauChoMaLoi`. */
  | { loai: "ma"; ma: string }
  /** TRPCClientError FORBIDDEN/UNAUTHORIZED — hiện NGUYÊN VĂN câu server (câu 2FA chỉ dẫn được việc). */
  | { loai: "server"; cau: string; la2fa: boolean }
  /** Mã khác/lỗi vận chuyển — câu chung KÈM chi tiết thật, không bịa nguyên nhân. */
  | { loai: "gui"; chiTiet: string };

/** Trạng thái bộ chọn thư mục — vỏ dựng từ query `duyetThuMuc`, ruột chỉ vẽ. */
export interface TrangThaiChonThuMuc {
  mo: boolean;
  dangTai: boolean;
  /** Đường đang xem (null ⇔ danh sách ổ đĩa). */
  duongHienTai: string | null;
  /** Đích của nút "lên một cấp" (null ⇔ cấp trên là danh sách ổ đĩa). */
  duongCha: string | null;
  muc: Array<{ ten: string; duong: string }>;
  biCat: boolean;
  /** Trần server khai (hiện trong câu bị cắt) — client không gán cứng con số. */
  tran: number;
  /** Câu lỗi đã dịch của lượt duyệt (null ⇔ không lỗi). */
  loi: string | null;
  /** true ⇔ đường hiện tại là thư mục THẬT server vừa liệt kê xong — mới cho "Chọn thư mục này". */
  chonDuoc: boolean;
}

/** Bộ chọn đang ĐÓNG — giá trị nền cho vỏ lẫn lưới. */
export const CHON_DANG_DONG: TrangThaiChonThuMuc = {
  mo: false,
  dangTai: false,
  duongHienTai: null,
  duongCha: null,
  muc: [],
  biCat: false,
  tran: 0,
  loi: null,
  chonDuoc: false,
};

interface NoiDungProps {
  muc: MucDuAnUI[];
  tranDb: number;
  dangTai: boolean;
  /** Lỗi của QUERY danh sách — có nó thì vẽ BĂNG LỖI, KHÔNG BAO GIỜ vẽ "Chưa có dự án nào." */
  loiTai: { cau: string; la2fa: boolean } | null;
  /** Lỗi của LƯỢT THÊM gần nhất (null ⇔ chưa lỗi) — vỏ giữ, để ruột thuần render được. */
  loiThem: LoiThemUI | null;
  dangThem: boolean;
  chon: TrangThaiChonThuMuc;
  onThem: (v: { id: string; ten: string; duongDan: string }) => void;
  onXoa: (id: string) => void;
  /** Mở bộ chọn — `goiY` là đường đang gõ dở trong ô (null ⇔ bắt đầu từ danh sách ổ đĩa). */
  onMoChon: (goiY: string | null) => void;
  /** Duyệt sang một đường khác (null ⇔ về danh sách ổ đĩa). */
  onDuyet: (duong: string | null) => void;
  onDongChon: () => void;
  /**
   * CHỈ CHO LƯỚI: giá trị đầu của form. `renderToStaticMarkup` không "gõ" được vào input, nên
   * nhánh kiểm-khi-gõ (câu đỏ + nút khoá) phải đo được qua giá trị khởi tạo — không dùng ở vỏ.
   */
  giaTriDau?: { id?: string; ten?: string; duongDan?: string };
}

/** RUỘT của dialog — xuất khẩu CHỈ để lưới dựng cây thật (Portal nuốt mất nó ở vỏ). */
export function NoiDungQuanLyDuAn({
  muc,
  tranDb,
  dangTai,
  loiTai,
  loiThem,
  dangThem,
  chon,
  onThem,
  onXoa,
  onMoChon,
  onDuyet,
  onDongChon,
  giaTriDau,
}: NoiDungProps) {
  const { t } = useTranslation();
  const [id, setId] = useState(giaTriDau?.id ?? "");
  const [ten, setTen] = useState(giaTriDau?.ten ?? "");
  const [duongDan, setDuongDan] = useState(giaTriDau?.duongDan ?? "");
  const soDb = muc.filter((m) => m.nguon === "db").length;
  // Kiểm-khi-gõ: cùng khuôn `RE_ID_DU_AN` server dùng — "Dự án demo" phải đỏ NGAY, không đợi server.
  const idSaiKhuon = id.trim() !== "" && !RE_ID_DU_AN.test(id.trim());
  const guiDuoc = RE_ID_DU_AN.test(id.trim()) && ten.trim() !== "" && duongDan.trim() !== "" && !dangThem;

  /** Chọn xong: điền ô đường dẫn; ID/Tên CHỈ gợi ý khi ô đang TRỐNG — không đè thứ người dùng đã gõ. */
  const chonThuMucNay = () => {
    if (!chon.chonDuoc || chon.duongHienTai === null) return;
    setDuongDan(chon.duongHienTai);
    const tenGoc = tenThuMucCuoi(chon.duongHienTai);
    if (id.trim() === "") setId(slugTuTenThuMuc(tenGoc));
    if (ten.trim() === "") {
      const tenSach = tenGoc.replace(/[#;=|]/g, "").trim(); // server cấm #;=| trong tên — gợi ý phải hợp lệ sẵn
      if (tenSach !== "") setTen(tenSach);
    }
    onDongChon();
  };

  const oNhap =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div data-noi-dung-du-an className="flex flex-col gap-3">
      {/* ── DANH SÁCH: query hỏng ⇒ BĂNG LỖI (không bao giờ giả danh danh-sách-rỗng) ── */}
      {loiTai ? (
        <div data-loi-tai role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2">
          <p className="text-[11px] font-semibold text-destructive">
            {t("repoWs.duan.loiTai", "Không tải được danh sách dự án — đây là LỖI truy vấn, không phải danh sách rỗng.")}
          </p>
          {loiTai.cau !== "" && (
            <p className={cn("mt-1 text-[11px] leading-snug", loiTai.la2fa ? "font-semibold text-amber-600" : "text-destructive/90")}>
              {loiTai.cau}
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {dangTai ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("repoWs.duan.loading", "Đang tải danh sách dự án…")}</p>
          ) : muc.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("repoWs.duan.empty", "Chưa có dự án nào.")}</p>
          ) : (
            muc.map((m) => (
              <div key={`${m.nguon}:${m.id}`} data-hang-du-an className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate text-[11px] font-semibold", !m.hoatDong && "text-muted-foreground line-through")}>{m.ten}</span>
                    <code className="shrink-0 rounded bg-muted px-1 text-[9px]">{m.id}</code>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide",
                        m.nguon === "env" ? "bg-amber-500/15 text-amber-600" : "bg-sky-500/15 text-sky-600",
                      )}
                    >
                      {m.nguon === "env" ? t("repoWs.duan.nguonEnv", ".env") : t("repoWs.duan.nguonDb", "UI")}
                    </span>
                    {!m.hoatDong && (
                      <span className="shrink-0 rounded bg-destructive/15 px-1 py-px text-[9px] text-destructive" title={t("repoWs.duan.hongTip", "Thư mục gốc không còn trên máy chủ, hoặc ID bị một mục .env che — mục này không hiện trong selectBox; xoá đi cho gọn.")}>
                        {t("repoWs.duan.hong", "mất gốc")}
                      </span>
                    )}
                  </div>
                  {/* Đường dẫn CHỈ hiện trong dialog admin-only này — listProjects (mọi người dùng) không trả nó. */}
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={m.goc}>{m.goc}</p>
                </div>
                {m.nguon === "env" ? (
                  <span className="shrink-0 p-1 text-muted-foreground" title={t("repoWs.duan.khoaEnv", "Khai trong .env — chỉ sửa được bằng tay trong .env của máy chủ.")}>
                    <Lock className="h-3.5 w-3.5" aria-label={t("repoWs.duan.khoaEnv", "Khai trong .env — chỉ sửa được bằng tay trong .env của máy chủ.")} />
                  </span>
                ) : (
                  <button
                    type="button"
                    data-nut-xoa-du-an
                    onClick={() => onXoa(m.id)}
                    title={t("repoWs.duan.xoa", "Xoá dự án này khỏi danh sách (không đụng vào thư mục trên đĩa)")}
                    aria-label={t("repoWs.duan.xoa", "Xoá dự án này khỏi danh sách (không đụng vào thư mục trên đĩa)")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── FORM THÊM ── */}
      <form
        data-form-them
        className="space-y-2 rounded-md border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (guiDuoc) onThem({ id: id.trim(), ten: ten.trim(), duongDan: duongDan.trim() });
        }}
      >
        <p className="flex items-center gap-1.5 text-[11px] font-semibold">
          <FolderPlus className="h-3.5 w-3.5" />
          {t("repoWs.duan.themTitle", "Thêm dự án ({{so}}/{{tran}} qua UI)", { so: soDb, tran: tranDb })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duan.oId", "ID (chữ/số/-/_)")}</span>
            <input
              data-o-id
              className={cn(oNhap, idSaiKhuon && "border-destructive focus-visible:ring-destructive")}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="du-an-moi"
            />
            {idSaiKhuon && (
              <p data-loi-id role="alert" className="text-[10px] leading-snug text-destructive">
                {t("repoWs.duan.err.idKhongHopLe", "ID chỉ được chứa chữ không dấu, số, gạch dưới, gạch nối (1–64 ký tự). Ví dụ: du-an-moi")}
              </p>
            )}
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duan.oTen", "Tên hiển thị")}</span>
            <input data-o-ten className={oNhap} value={ten} onChange={(e) => setTen(e.target.value)} placeholder={t("repoWs.duan.oTenGoiY", "Dự án mới")} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duan.oDuong", "Đường dẫn TUYỆT ĐỐI trên máy chủ")}</span>
          <div className="flex gap-1.5">
            <input data-o-duong className={cn(oNhap, "min-w-0 flex-1 font-mono")} value={duongDan} onChange={(e) => setDuongDan(e.target.value)} placeholder="D:\DuAn\ten-du-an" />
            {/* Bộ chọn là TIỆN ÍCH, không phải rào — ô vẫn sửa tay được. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-nut-chon-thu-muc
              className="h-8 shrink-0 px-2 text-[11px]"
              onClick={() => (chon.mo ? onDongChon() : onMoChon(duongDan.trim() === "" ? null : duongDan.trim()))}
            >
              <FolderSearch className="mr-1 h-3 w-3" />
              {t("repoWs.duan.chonNut", "Chọn thư mục…")}
            </Button>
          </div>
        </label>

        {/* ── BỘ CHỌN THƯ MỤC (duyệt đĩa MÁY CHỦ một cấp mỗi lượt) ── */}
        {chon.mo && (
          <div data-bo-chon-thu-muc className="space-y-1.5 rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-nut-len-cap
                disabled={chon.duongHienTai === null}
                onClick={() => onDuyet(chon.duongCha)}
                title={t("repoWs.duan.chonLenCap", "Lên một cấp")}
                aria-label={t("repoWs.duan.chonLenCap", "Lên một cấp")}
                className="shrink-0 rounded border p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <p data-duong-hien-tai className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={chon.duongHienTai ?? undefined}>
                {chon.duongHienTai ?? t("repoWs.duan.chonODia", "Ổ đĩa trên máy chủ")}
              </p>
              <Button type="button" size="sm" data-nut-chon-day className="h-6 shrink-0 px-2 text-[10px]" disabled={!chon.chonDuoc} onClick={chonThuMucNay}>
                {t("repoWs.duan.chonDay", "Chọn thư mục này")}
              </Button>
            </div>
            {chon.loi ? (
              <p data-loi-duyet role="alert" className="rounded bg-destructive/10 px-2 py-1 text-[10px] leading-snug text-destructive">{chon.loi}</p>
            ) : chon.dangTai ? (
              <p className="px-1 py-1 text-[10px] text-muted-foreground">{t("repoWs.duan.chonDangTai", "Đang đọc thư mục trên máy chủ…")}</p>
            ) : (
              <div className="max-h-40 space-y-px overflow-y-auto">
                {chon.muc.length === 0 ? (
                  <p className="px-1 py-1 text-[10px] text-muted-foreground">
                    {t("repoWs.duan.chonRong", "Không có thư mục con nào — bấm \u201cChọn thư mục này\u201d nếu đây là nơi cần đăng ký.")}
                  </p>
                ) : (
                  chon.muc.map((m) => (
                    <button
                      key={m.duong}
                      type="button"
                      data-muc-thu-muc
                      onClick={() => onDuyet(m.duong)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted"
                      title={m.duong}
                    >
                      <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{m.ten}</span>
                    </button>
                  ))
                )}
                {chon.biCat && (
                  <p data-bi-cat className="px-1.5 py-1 text-[10px] text-amber-600">
                    {t("repoWs.duan.chonBiCat", "Chỉ hiện {{tran}} mục đầu — thư mục này còn nhiều hơn; gõ tay phần còn lại của đường dẫn nếu cần.", { tran: chon.tran })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {loiThem && (
          <p
            data-loi-them
            role="alert"
            className={cn(
              "rounded px-2 py-1 text-[11px] leading-snug",
              loiThem.loai === "server" && loiThem.la2fa
                ? "bg-amber-500/10 font-medium text-amber-700"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {loiThem.loai === "ma"
              ? cauChoMaLoi(loiThem.ma, t)
              : loiThem.loai === "server"
                ? loiThem.cau
                : t("repoWs.duan.err.guiThatBai", "Không gửi được yêu cầu tới máy chủ — chi tiết: {{chiTiet}}", { chiTiet: loiThem.chiTiet })}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          {/* Server xác thực THẬT (realpath/lồng gốc/trần) — câu này nói trước để lỗi không gây ngạc nhiên. */}
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t("repoWs.duan.ghiChu", "Thư mục phải CÓ SẴN trên máy chủ; server kiểm tra rồi mới nhận.")}
          </p>
          <Button type="submit" size="sm" className="h-7 shrink-0 text-xs" disabled={!guiDuoc} data-nut-them>
            {dangThem && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t("repoWs.duan.nutThem", "Thêm")}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface QuanLyDuAnRepoProps {
  /** Trang chỉ gắn khi admin — nhưng đây là phép LỊCH SỰ; hàng rào là `adminProcedure` ở server. */
  className?: string;
}

/** VỎ: nút bánh răng cạnh selectBox dự án — mở dialog quản lý. */
export function QuanLyDuAnRepo({ className }: QuanLyDuAnRepoProps) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const [loiThem, setLoiThem] = useState<LoiThemUI | null>(null);
  const [chonMo, setChonMo] = useState(false);
  const [duongDuyet, setDuongDuyet] = useState<string | null>(null);
  const utils = trpc.useUtils();
  // `enabled: mo` — thủ tục admin-only, đừng bắn query (và nhận FORBIDDEN) khi dialog chưa mở.
  const dsQ = trpc.repoWorkspace.danhSachDayDu.useQuery(undefined, { enabled: mo, staleTime: 10_000 });
  // Bộ chọn: chỉ hỏi khi ĐANG mở (dialog + panel). `staleTime: 0` — API khai "không cache, đọc hệ
  // tệp SỐNG"; client giữ một ảnh chụp 5 giây là phản lại lời khai ấy. `retry: false` — đường xấu
  // là ca TẤT ĐỊNH, retry chỉ bắt người dùng chờ ba lượt cho cùng một câu từ chối.
  const duyetQ = trpc.repoWorkspace.duyetThuMuc.useQuery(
    { duong: duongDuyet ?? undefined },
    { enabled: mo && chonMo, staleTime: 0, retry: false },
  );

  /** Sau MỖI mutation xanh: selectBox (`listProjects`) + danh sách dialog cùng làm tươi — không F5. */
  const lamTuoi = () => {
    void utils.repoWorkspace.listProjects.invalidate();
    void utils.repoWorkspace.danhSachDayDu.invalidate();
  };

  const themM = trpc.repoWorkspace.themDuAn.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        setLoiThem(null);
        lamTuoi();
        toast.success(t("repoWs.duan.daThem", "Đã thêm dự án — selectBox đã có mục mới."));
      } else {
        setLoiThem({ loai: "ma", ma: r.ma });
      }
    },
    // ⚠ KHÔNG nuốt lỗi thật (bài học 2026-08-23): FORBIDDEN/UNAUTHORIZED mang câu server chỉ dẫn
    //   được việc (câu 2FA của adminProcedure); mã khác ⇒ câu chung + chi tiết THẬT.
    onError: (e) => {
      const l = docLoiTrpc(e);
      setLoiThem(
        (l.code === "FORBIDDEN" || l.code === "UNAUTHORIZED") && l.cau !== ""
          ? { loai: "server", cau: l.cau, la2fa: l.la2fa }
          : { loai: "gui", chiTiet: l.cau !== "" ? l.cau : (l.code ?? "?") },
      );
    },
  });
  const xoaM = trpc.repoWorkspace.xoaDuAn.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        lamTuoi();
        toast.success(t("repoWs.duan.daXoa", "Đã xoá dự án khỏi danh sách."));
      } else {
        toast.error(cauChoMaLoi(r.ma, t));
      }
    },
    // Cùng luật với `themM`: câu server (nếu có) thắng; không nuốt, không hiện `.message` thô
    // ngoài khuôn i18n (cổng `clientErrorCoverage` đã bắt đúng dòng cũ ở đây).
    onError: (e) => {
      const l = docLoiTrpc(e);
      toast.error(
        l.cau !== ""
          ? l.cau
          : t("repoWs.duan.err.guiThatBai", "Không gửi được yêu cầu tới máy chủ — chi tiết: {{chiTiet}}", { chiTiet: l.code ?? "?" }),
      );
    },
  });

  // Băng lỗi danh sách: đúng thông điệp server — KHÔNG để nhánh rỗng-danh-sách giả danh nó.
  const loiTaiTho = dsQ.isError ? docLoiTrpc(dsQ.error) : null;
  const loiTai = loiTaiTho ? { cau: loiTaiTho.cau, la2fa: loiTaiTho.la2fa } : null;

  // Trạng thái bộ chọn — vỏ dựng, ruột chỉ vẽ.
  const kqDuyet = duyetQ.data;
  const chon: TrangThaiChonThuMuc = !chonMo
    ? CHON_DANG_DONG
    : {
        mo: true,
        dangTai: duyetQ.isFetching,
        duongHienTai: kqDuyet?.ok ? kqDuyet.duongHienTai : duongDuyet,
        duongCha: kqDuyet?.ok ? kqDuyet.duongCha : null,
        muc: kqDuyet?.ok ? kqDuyet.muc : [],
        biCat: kqDuyet?.ok === true && kqDuyet.biCat,
        tran: kqDuyet?.ok ? kqDuyet.tran : 0,
        loi: duyetQ.isError
          ? docLoiTrpc(duyetQ.error).cau || cauChoMaLoi("DUONG_KHONG_HOP_LE", t)
          : kqDuyet && !kqDuyet.ok
            ? cauChoMaLoi(kqDuyet.ma, t)
            : null,
        chonDuoc: kqDuyet?.ok === true && kqDuyet.duongHienTai !== null && !duyetQ.isFetching,
      };

  return (
    <Dialog
      open={mo}
      onOpenChange={(o) => {
        setMo(o);
        if (o) {
          setLoiThem(null); // lỗi của lượt trước không được ám lượt này
          setChonMo(false); // bộ chọn mở dở của lượt trước cũng vậy
          setDuongDuyet(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-nut-quan-ly-du-an
          className={cn("h-5 w-5", className)}
          title={t("repoWs.duan.moTitle", "Quản lý dự án (admin)")}
          aria-label={t("repoWs.duan.moTitle", "Quản lý dự án (admin)")}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("repoWs.duan.title", "Quản lý dự án")}</DialogTitle>
          <DialogDescription>
            {t(
              "repoWs.duan.moTa",
              "Thêm/xoá thư mục dự án cho không gian lập trình AI. Mục .env chỉ sửa được bằng tay; mục thêm ở đây có hiệu lực NGAY, không cần khởi động lại.",
            )}
          </DialogDescription>
        </DialogHeader>
        <NoiDungQuanLyDuAn
          muc={(dsQ.data?.projects ?? []) as MucDuAnUI[]}
          tranDb={dsQ.data?.tranDb ?? 20}
          dangTai={dsQ.isLoading}
          loiTai={loiTai}
          loiThem={loiThem}
          dangThem={themM.isPending}
          chon={chon}
          onThem={(v) => {
            setLoiThem(null);
            themM.mutate(v);
          }}
          onXoa={(idXoa) => {
            if (window.confirm(t("repoWs.duan.hoiXoa", "Xoá dự án này khỏi danh sách? Thư mục trên đĩa KHÔNG bị đụng tới."))) {
              xoaM.mutate({ id: idXoa });
            }
          }}
          onMoChon={(goiY) => {
            setDuongDuyet(goiY);
            setChonMo(true);
          }}
          onDuyet={(d) => setDuongDuyet(d)}
          onDongChon={() => setChonMo(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
