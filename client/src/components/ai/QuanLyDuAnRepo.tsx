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
 *      với admin sửa `.env`, và server xác thực FAIL-CLOSED (mỗi lỗi một mã).
 *   2. **Client ẩn nút chỉ là phép lịch sự** — trang chỉ gắn component này cho `role === "admin"`,
 *      nhưng hàng rào THẬT là `adminProcedure` ở server: gọi thẳng API bằng tài khoản thường vẫn
 *      nhận FORBIDDEN.
 *   3. **Mục nguồn env KHÔNG xoá được** — server từ chối (`MUC_ENV_KHONG_XOA_DUOC`); UI hiện ổ
 *      khoá thay nút xoá để người dùng không bấm vào một cánh cửa đóng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH TỆP + XUẤT KHẨU RUỘT — cùng lý do `BoChonPhien` (đọc docblock tệp ấy): Radix
 * `Dialog` đi qua Portal, một lưới `renderToStaticMarkup` dựng vỏ sẽ KHÔNG BAO GIỜ thấy nội dung
 * bên trong — xanh hay đỏ đều vì lý do sai. Nên ruột (`NoiDungQuanLyDuAn`) + phép dịch mã lỗi
 * (`cauChoMaLoi`) là hàm/component THUẦN xuất khẩu cho lưới dựng thẳng cây thật;
 * `QuanLyDuAnRepo` chỉ là vỏ: nút bánh răng + dây nối tRPC.
 *
 * ⚠ SAU MỖI thêm/xoá thành công: invalidate CẢ `danhSachDayDu` (danh sách trong dialog) LẪN
 *   `listProjects` (selectBox của trang) — selectBox có mục mới NGAY, không cần F5. Server đã
 *   `napLaiDuAnTuDb()` trong chính mutation nên lượt refetch đọc được ảnh chụp mới.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Loader2, Lock, Settings2, Trash2 } from "lucide-react";
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
    default:
      return t("repoWs.duan.err.khac", "Server từ chối với mã {{ma}} — báo cho người phụ trách hệ thống.", { ma });
  }
}

interface NoiDungProps {
  muc: MucDuAnUI[];
  tranDb: number;
  dangTai: boolean;
  /** Mã lỗi của LƯỢT THÊM gần nhất (null ⇔ chưa lỗi) — vỏ giữ, để ruột thuần render được. */
  loiThem: string | null;
  dangThem: boolean;
  onThem: (v: { id: string; ten: string; duongDan: string }) => void;
  onXoa: (id: string) => void;
}

/** RUỘT của dialog — xuất khẩu CHỈ để lưới dựng cây thật (Portal nuốt mất nó ở vỏ). */
export function NoiDungQuanLyDuAn({ muc, tranDb, dangTai, loiThem, dangThem, onThem, onXoa }: NoiDungProps) {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [ten, setTen] = useState("");
  const [duongDan, setDuongDan] = useState("");
  const soDb = muc.filter((m) => m.nguon === "db").length;
  const guiDuoc = id.trim() !== "" && ten.trim() !== "" && duongDan.trim() !== "" && !dangThem;

  const oNhap =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div data-noi-dung-du-an className="flex flex-col gap-3">
      {/* ── DANH SÁCH: nhãn nguồn env = ổ khoá · db = nút xoá ── */}
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
            <input data-o-id className={oNhap} value={id} onChange={(e) => setId(e.target.value)} placeholder="du-an-moi" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duan.oTen", "Tên hiển thị")}</span>
            <input data-o-ten className={oNhap} value={ten} onChange={(e) => setTen(e.target.value)} placeholder={t("repoWs.duan.oTenGoiY", "Dự án mới")} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duan.oDuong", "Đường dẫn TUYỆT ĐỐI trên máy chủ")}</span>
          <input data-o-duong className={cn(oNhap, "font-mono")} value={duongDan} onChange={(e) => setDuongDan(e.target.value)} placeholder="D:\DuAn\ten-du-an" />
        </label>
        {loiThem && (
          <p data-loi-them role="alert" className="rounded bg-destructive/10 px-2 py-1 text-[11px] leading-snug text-destructive">
            {cauChoMaLoi(loiThem, t)}
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
  const [loiThem, setLoiThem] = useState<string | null>(null);
  const utils = trpc.useUtils();
  // `enabled: mo` — thủ tục admin-only, đừng bắn query (và nhận FORBIDDEN) khi dialog chưa mở.
  const dsQ = trpc.repoWorkspace.danhSachDayDu.useQuery(undefined, { enabled: mo, staleTime: 10_000 });

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
        setLoiThem(r.ma);
      }
    },
    onError: () => setLoiThem("LUU_THAT_BAI"),
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
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog
      open={mo}
      onOpenChange={(o) => {
        setMo(o);
        if (o) setLoiThem(null); // lỗi của lượt trước không được ám lượt này
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
          loiThem={loiThem}
          dangThem={themM.isPending}
          onThem={(v) => {
            setLoiThem(null);
            themM.mutate(v);
          }}
          onXoa={(idXoa) => {
            if (window.confirm(t("repoWs.duan.hoiXoa", "Xoá dự án này khỏi danh sách? Thư mục trên đĩa KHÔNG bị đụng tới."))) {
              xoaM.mutate({ id: idXoa });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
