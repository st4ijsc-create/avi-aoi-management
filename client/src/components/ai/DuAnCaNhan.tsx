/**
 * ★★★ Đợt 3a (2026-10-17, quyết định Q3) — **DỰ ÁN CỦA TÔI**: kỹ sư tạo / mở / đổi tên / xoá dự án cá nhân ngay trong
 * dialog Quản lý dự án của `AICodingWorkspace` — KHÔNG cần admin, KHÔNG cần 2FA, KHÔNG cần thư mục có sẵn.
 *
 * Bốn cách tạo (server đặt thư mục, client KHÔNG BAO GIỜ gửi đường dẫn): rỗng · từ khuôn có sẵn · nhập ZIP · clone git
 * nội bộ (chỉ hiện khi máy chủ khai danh sách trắng). Cộng một lối tắt "Từ mô tả": tạo dự án RỖNG rồi mở chế độ Agent
 * với câu mô tả trong ô chat — không có bộ sinh khung riêng (vòng agent đã làm được việc ấy, Đợt 1/2).
 *
 * ⚠ Ẩn/khoá nút ở đây là phép LỊCH SỰ; hàng rào thật ở server (`repoWorkspace.taoDuAnCaNhan`: `ai_repo_read` +
 *   `ai_repo_exec`, chủ = phiên, trần số/dung lượng, zip-slip/zip bomb, danh sách trắng git).
 * ⚠ Ruột (`NoiDungDuAnCaNhan`) THUẦN theo props — lưới DOM dựng thẳng nó (Radix Dialog đi qua Portal; khuôn
 *   `QuanLyDuAnRepo`/`BoChonPhien`). Vỏ (`DuAnCaNhan`) chỉ là dây tRPC.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, FolderOpen, Loader2, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

type HamDich = (khoa: string, macDinh: string, tham?: Record<string, unknown>) => string;

/** Cách tạo ở UI — `mo-ta` là lối tắt: server nhận `rong`, client mở Agent với mô tả sau khi tạo. */
export type CachTaoUI = "rong" | "khuon" | "zip" | "git" | "mo-ta";

export interface YeuCauTaoUI {
  ten: string;
  cachTao: CachTaoUI;
  khuon?: string;
  zip?: File | null;
  nguonGit?: string;
  moTa?: string;
}

/** Trần ZIP tải lên (khớp `TRAN_BYTE_ZIP_TAI_LEN` ở server) — kiểm sớm để không đẩy 200 MB rồi mới bị từ chối. */
export const TRAN_ZIP_CLIENT = 50 * 1024 * 1024;

/** ★ THUẦN — mã từ chối server → một câu nói rõ phải làm gì. Mã lạ ⇒ câu chung + mã thô. */
export function cauChoMaLoiCaNhan(ma: string, t: HamDich): string {
  switch (ma) {
    case "PERMISSION_DENIED":
      return t("repoWs.duanCaNhan.err.quyen", "Tài khoản chưa có quyền tạo dự án (cần quyền chạy lệnh AI — ai_repo_exec). Nhờ quản trị cấp quyền.");
    case "TEN_KHONG_HOP_LE":
      return t("repoWs.duanCaNhan.err.ten", "Tên phải có 1–100 ký tự và không chứa # ; = |.");
    case "KHUON_KHONG_CO":
      return t("repoWs.duanCaNhan.err.khuon", "Không có khuôn này trên máy chủ. Chọn một khuôn trong danh sách.");
    case "ZIP_THIEU":
      return t("repoWs.duanCaNhan.err.zipThieu", "Chưa chọn tệp ZIP.");
    case "ZIP_HONG":
      return t("repoWs.duanCaNhan.err.zipHong", "Tệp không phải ZIP hợp lệ (hoặc bị hỏng).");
    case "ZIP_DUONG_DAN_XAU":
      return t("repoWs.duanCaNhan.err.zipDuong", "ZIP chứa đường dẫn nguy hiểm (../, ổ đĩa, đường tuyệt đối) — đã từ chối cả tệp, không giải nén gì.");
    case "ZIP_SYMLINK":
      return t("repoWs.duanCaNhan.err.zipSymlink", "ZIP chứa liên kết tượng trưng (symlink) — đã từ chối. Nén lại thư mục không kèm symlink.");
    case "ZIP_QUA_NHIEU_MUC":
      return t("repoWs.duanCaNhan.err.zipNhieu", "ZIP có quá nhiều tệp. Bỏ node_modules/bin/obj rồi nén lại.");
    case "ZIP_QUA_LON":
    case "ZIP_TEP_QUA_LON":
      return t("repoWs.duanCaNhan.err.zipLon", "ZIP quá lớn sau khi giải nén (hoặc vượt dung lượng còn lại của bạn).");
    case "ZIP_TI_LE_NEN":
      return t("repoWs.duanCaNhan.err.zipBom", "ZIP có tỉ lệ nén bất thường (nghi zip bomb) — đã từ chối.");
    case "ZIP_GHI_THAT_BAI":
      return t("repoWs.duanCaNhan.err.zipGhi", "Không ghi được một tệp trong ZIP (trùng tên khác hoa/thường?).");
    case "GIT_TAT":
      return t("repoWs.duanCaNhan.err.gitTat", "Máy chủ chưa bật clone git (chưa khai danh sách máy chủ git nội bộ).");
    case "GIT_NGUON_KHONG_HOP_LE":
      return t("repoWs.duanCaNhan.err.gitNguon", "Nguồn git không hợp lệ. Dùng URL https://… của máy chủ git nội bộ hoặc đường thư mục được phép.");
    case "GIT_NGOAI_DANH_SACH":
      return t("repoWs.duanCaNhan.err.gitNgoai", "Nguồn này không nằm trong danh sách máy chủ git nội bộ được phép (hệ chạy offline).");
    case "GIT_CLONE_THAT_BAI":
      return t("repoWs.duanCaNhan.err.gitClone", "Clone thất bại — kiểm tra URL/quyền truy cập máy chủ git.");
    case "GIT_HET_GIO":
      return t("repoWs.duanCaNhan.err.gitHetGio", "Clone quá thời gian cho phép — repo quá lớn hoặc máy chủ git không phản hồi.");
    case "VUOT_TRAN_SO_DU_AN":
      return t("repoWs.duanCaNhan.err.tranSo", "Bạn đã đủ số dự án tối đa. Xoá bớt một dự án không dùng rồi tạo lại.");
    case "VUOT_TRAN_DUNG_LUONG":
      return t("repoWs.duanCaNhan.err.tranByte", "Vượt dung lượng cho phép của bạn. Xoá bớt dự án (thùng rác giữ 30 ngày, không tính vào dung lượng).");
    case "DANG_TAO":
      return t("repoWs.duanCaNhan.err.dangTao", "Đang tạo một dự án khác của bạn — đợi xong rồi thử lại.");
    case "GOC_QUAN_LY_KHONG_HOP_LE":
      return t("repoWs.duanCaNhan.err.goc", "Thư mục gốc dự án trên máy chủ cấu hình sai (AI_PROJECTS_ROOT) — báo quản trị.");
    case "GUI_THAT_BAI":
      return t("repoWs.duanCaNhan.err.gui", "Không gửi được yêu cầu tới máy chủ — chi tiết:");
    case "KHONG_TIM_THAY":
      return t("repoWs.duanCaNhan.err.khongThay", "Không thấy dự án này (có thể đã bị xoá). Tải lại danh sách.");
    default:
      return t("repoWs.duanCaNhan.err.khac", "Máy chủ từ chối với mã {{ma}}.", { ma });
  }
}

/** ★ THUẦN — byte → chuỗi ngắn (MB/GB). */
export function dinhDangByte(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export interface NoiDungDuAnCaNhanProps {
  duAn: Array<{ id: string; ten: string }>;
  soDuAn: number;
  tranSoDuAn: number;
  daDung: number;
  tranByte: number;
  khuon: string[];
  coGit: boolean;
  coQuyenTao: boolean;
  dangTai: boolean;
  /** Lỗi QUERY danh sách — có thì vẽ băng lỗi, không bao giờ vẽ "chưa có dự án". */
  loiTai: string | null;
  dangTao: boolean;
  /** Câu lỗi của lượt tạo gần nhất (đã dịch). */
  loiTao: string | null;
  onTao: (y: YeuCauTaoUI) => void;
  onDoiTen: (id: string, ten: string) => void;
  onXoa: (id: string) => void;
  onChon: (id: string) => void;
  /** CHỈ CHO LƯỚI: giá trị đầu của form. */
  giaTriDau?: Partial<YeuCauTaoUI>;
}

const TEN_XAU = /[#;=|]/;

/** RUỘT — thuần theo props. */
export function NoiDungDuAnCaNhan(p: NoiDungDuAnCaNhanProps) {
  const { t } = useTranslation();
  const [ten, setTen] = useState(p.giaTriDau?.ten ?? "");
  const [cachTao, setCachTao] = useState<CachTaoUI>(p.giaTriDau?.cachTao ?? "rong");
  const [khuon, setKhuon] = useState(p.giaTriDau?.khuon ?? p.khuon[0] ?? "");
  const [zip, setZip] = useState<File | null>(null);
  const [nguonGit, setNguonGit] = useState(p.giaTriDau?.nguonGit ?? "");
  const [moTa, setMoTa] = useState(p.giaTriDau?.moTa ?? "");
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [tenSua, setTenSua] = useState("");

  const tenSach = ten.trim();
  const tenLoi = tenSach !== "" && (tenSach.length > 100 || TEN_XAU.test(tenSach));
  const zipQuaLon = zip !== null && zip.size > TRAN_ZIP_CLIENT;
  const duDieuKien =
    cachTao === "rong" ||
    (cachTao === "khuon" && khuon !== "") ||
    (cachTao === "zip" && zip !== null && !zipQuaLon) ||
    (cachTao === "git" && nguonGit.trim() !== "") ||
    (cachTao === "mo-ta" && moTa.trim() !== "");
  const hetSuat = p.soDuAn >= p.tranSoDuAn && p.tranSoDuAn > 0;
  const guiDuoc = p.coQuyenTao && !p.dangTao && tenSach !== "" && !tenLoi && duDieuKien && !hetSuat;
  const oNhap =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const cacCach: Array<{ v: CachTaoUI; nhan: string }> = [
    { v: "rong", nhan: t("repoWs.duanCaNhan.cach.rong", "Rỗng") },
    { v: "khuon", nhan: t("repoWs.duanCaNhan.cach.khuon", "Từ khuôn") },
    { v: "zip", nhan: t("repoWs.duanCaNhan.cach.zip", "Nhập ZIP") },
    ...(p.coGit ? [{ v: "git" as const, nhan: t("repoWs.duanCaNhan.cach.git", "Git nội bộ") }] : []),
    { v: "mo-ta", nhan: t("repoWs.duanCaNhan.cach.moTa", "Từ mô tả (Agent)") },
  ];

  return (
    <div data-du-an-ca-nhan className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold">{t("repoWs.duanCaNhan.title", "Dự án của tôi")}</p>
        <p data-dung-luong className="text-[10px] text-muted-foreground">
          {t("repoWs.duanCaNhan.dungLuong", "{{so}}/{{tran}} dự án · {{daDung}} / {{tranByte}}", {
            so: p.soDuAn,
            tran: p.tranSoDuAn,
            daDung: dinhDangByte(p.daDung),
            tranByte: dinhDangByte(p.tranByte),
          })}
        </p>
      </div>

      {p.loiTai ? (
        <p data-loi-tai-ca-nhan role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2 text-[11px] text-destructive">
          {t("repoWs.duanCaNhan.loiTai", "Không tải được danh sách dự án của bạn — đây là LỖI, không phải danh sách rỗng.")} {p.loiTai}
        </p>
      ) : (
        <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {p.dangTai ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("repoWs.duanCaNhan.dangTai", "Đang tải…")}</p>
          ) : p.duAn.length === 0 ? (
            <p data-rong className="px-2 py-3 text-[11px] text-muted-foreground">
              {t("repoWs.duanCaNhan.rong", "Bạn chưa có dự án nào — tạo một dự án bên dưới.")}
            </p>
          ) : (
            p.duAn.map((d) => (
              <div key={d.id} data-hang-ca-nhan={d.id} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted">
                {dangSua === d.id ? (
                  <>
                    <input
                      data-o-doi-ten
                      className={cn(oNhap, "h-7 flex-1")}
                      value={tenSua}
                      onChange={(e) => setTenSua(e.target.value)}
                      aria-label={t("repoWs.duanCaNhan.doiTen", "Đổi tên")}
                    />
                    <button
                      type="button"
                      data-nut-luu-ten
                      disabled={tenSua.trim() === "" || TEN_XAU.test(tenSua)}
                      onClick={() => {
                        p.onDoiTen(d.id, tenSua.trim());
                        setDangSua(null);
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                      aria-label={t("repoWs.duanCaNhan.luuTen", "Lưu tên")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setDangSua(null)} className="rounded p-1 text-muted-foreground" aria-label={t("repoWs.duanCaNhan.huy", "Huỷ")}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-nut-mo-du-an={d.id}
                      onClick={() => p.onChon(d.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={t("repoWs.duanCaNhan.mo", "Mở dự án này")}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[11px] font-semibold">{d.ten}</span>
                    </button>
                    {p.coQuyenTao && (
                      <>
                        <button
                          type="button"
                          data-nut-doi-ten={d.id}
                          onClick={() => {
                            setDangSua(d.id);
                            setTenSua(d.ten);
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                          aria-label={t("repoWs.duanCaNhan.doiTen", "Đổi tên")}
                          title={t("repoWs.duanCaNhan.doiTen", "Đổi tên")}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          data-nut-xoa-ca-nhan={d.id}
                          onClick={() => p.onXoa(d.id)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                          aria-label={t("repoWs.duanCaNhan.xoa", "Xoá (vào thùng rác 30 ngày)")}
                          title={t("repoWs.duanCaNhan.xoa", "Xoá (vào thùng rác 30 ngày)")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {!p.coQuyenTao ? (
        <p data-khong-quyen-tao className="rounded-md bg-muted px-2 py-2 text-[11px] text-muted-foreground">
          {cauChoMaLoiCaNhan("PERMISSION_DENIED", t)}
        </p>
      ) : (
        <form
          data-form-tao
          className="space-y-2 rounded-md border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guiDuoc) return;
            p.onTao({
              ten: tenSach,
              cachTao,
              ...(cachTao === "khuon" ? { khuon } : {}),
              ...(cachTao === "zip" ? { zip } : {}),
              ...(cachTao === "git" ? { nguonGit: nguonGit.trim() } : {}),
              ...(cachTao === "mo-ta" ? { moTa: moTa.trim() } : {}),
            });
          }}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold">
            <Plus className="h-3.5 w-3.5" />
            {t("repoWs.duanCaNhan.taoMoi", "Tạo dự án mới")}
          </p>
          <div role="radiogroup" aria-label={t("repoWs.duanCaNhan.cachTao", "Cách tạo")} className="flex flex-wrap gap-1">
            {cacCach.map((c) => (
              <button
                key={c.v}
                type="button"
                role="radio"
                aria-checked={cachTao === c.v}
                data-cach-tao={c.v}
                onClick={() => setCachTao(c.v)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[10px]",
                  cachTao === c.v ? "border-primary bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {c.nhan}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duanCaNhan.oTen", "Tên dự án")}</span>
            <input
              data-o-ten-ca-nhan
              className={cn(oNhap, tenLoi && "border-destructive")}
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              placeholder={t("repoWs.duanCaNhan.oTenGoiY", "Ví dụ: Công cụ đọc log máy AOI")}
            />
            {tenLoi && (
              <p data-loi-ten role="alert" className="text-[10px] text-destructive">
                {cauChoMaLoiCaNhan("TEN_KHONG_HOP_LE", t)}
              </p>
            )}
          </label>

          {cachTao === "khuon" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">{t("repoWs.duanCaNhan.oKhuon", "Khuôn")}</span>
              <select data-chon-khuon className={oNhap} value={khuon} onChange={(e) => setKhuon(e.target.value)}>
                {p.khuon.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          {cachTao === "zip" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">
                {t("repoWs.duanCaNhan.oZip", "Tệp ZIP (tối đa 50 MB; tệp chạy được và bí mật sẽ bị bỏ qua)")}
              </span>
              <input data-o-zip type="file" accept=".zip,application/zip" className="block w-full text-[10px]" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
              {zipQuaLon && (
                <p data-loi-zip role="alert" className="text-[10px] text-destructive">
                  {cauChoMaLoiCaNhan("ZIP_QUA_LON", t)}
                </p>
              )}
            </label>
          )}
          {cachTao === "git" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">
                {t("repoWs.duanCaNhan.oGit", "URL máy chủ git nội bộ (hoặc thư mục được phép)")}
              </span>
              <input data-o-git className={cn(oNhap, "font-mono")} value={nguonGit} onChange={(e) => setNguonGit(e.target.value)} placeholder="https://git.xuong.local/nhom/du-an.git" />
            </label>
          )}
          {cachTao === "mo-ta" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">
                {t("repoWs.duanCaNhan.oMoTa", "Mô tả dự án — tạo dự án rỗng rồi mở chế độ Agent với mô tả này")}
              </span>
              <textarea
                data-o-mo-ta
                rows={3}
                className={cn(oNhap, "h-auto py-1")}
                value={moTa}
                onChange={(e) => setMoTa(e.target.value)}
                placeholder={t("repoWs.duanCaNhan.oMoTaGoiY", "Ví dụ: Ứng dụng console C# đọc tệp CSV kết quả AOI và in tỉ lệ lỗi theo ca")}
              />
            </label>
          )}

          {p.loiTao && (
            <p data-loi-tao role="alert" className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {p.loiTao}
            </p>
          )}
          {hetSuat && (
            <p data-het-suat className="text-[10px] text-amber-600">
              {cauChoMaLoiCaNhan("VUOT_TRAN_SO_DU_AN", t)}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={!guiDuoc} data-nut-tao>
              {p.dangTao ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderGit2 className="mr-1 h-3 w-3" />}
              {t("repoWs.duanCaNhan.nutTao", "Tạo")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Đọc một `File` thành base64 (không tiền tố data URL). */
function docBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("FileReader"));
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(f);
  });
}

export interface DuAnCaNhanProps {
  /** Mở dự án (đổi selectBox của trang). */
  onChonDuAn?: (id: string) => void;
  /** "Từ mô tả": dự án rỗng đã tạo ⇒ trang chuyển sang chế độ Agent và đặt mô tả vào ô chat. */
  onTaoTuMoTa?: (id: string, moTa: string) => void;
  /** Đóng dialog sau khi mở/tạo xong. */
  onXong?: () => void;
}

/** VỎ — dây tRPC. */
export function DuAnCaNhan({ onChonDuAn, onTaoTuMoTa, onXong }: DuAnCaNhanProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.repoWorkspace.duAnCuaToi.useQuery(undefined, { staleTime: 5_000 });
  const [loiTao, setLoiTao] = useState<string | null>(null);
  const [dangDoc, setDangDoc] = useState(false);

  const lamTuoi = async () => {
    await Promise.all([utils.repoWorkspace.listProjects.invalidate(), utils.repoWorkspace.duAnCuaToi.invalidate()]);
  };
  const taoM = trpc.repoWorkspace.taoDuAnCaNhan.useMutation();
  const doiTenM = trpc.repoWorkspace.doiTenDuAnCaNhan.useMutation({
    onSuccess: (r) => {
      if (r.ok) void lamTuoi();
      else toast.error(cauChoMaLoiCaNhan(r.ma, t));
    },
    onError: (e) => toast.error(cauChoMaLoiCaNhan("GUI_THAT_BAI", t) + ` ${mapTrpcError(e)}`),
  });
  const xoaM = trpc.repoWorkspace.xoaDuAnCaNhan.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        void lamTuoi();
        toast.success(t("repoWs.duanCaNhan.daXoa", "Đã chuyển dự án vào thùng rác (giữ 30 ngày)."));
      } else toast.error(cauChoMaLoiCaNhan(r.ma, t));
    },
    onError: (e) => toast.error(cauChoMaLoiCaNhan("GUI_THAT_BAI", t) + ` ${mapTrpcError(e)}`),
  });

  const d = q.data;
  return (
    <NoiDungDuAnCaNhan
      duAn={d?.projects ?? []}
      soDuAn={d?.soDuAn ?? 0}
      tranSoDuAn={d?.tranSoDuAn ?? 0}
      daDung={d?.daDung ?? 0}
      tranByte={d?.tranByte ?? 0}
      khuon={d?.khuon ?? []}
      coGit={d?.coGit ?? false}
      coQuyenTao={d?.coQuyenTao ?? false}
      dangTai={q.isLoading}
      loiTai={q.isError ? mapTrpcError(q.error) : d && !d.ok ? cauChoMaLoiCaNhan(d.note ?? "PERMISSION_DENIED", t) : null}
      dangTao={taoM.isPending || dangDoc}
      loiTao={loiTao}
      onTao={async (y) => {
        setLoiTao(null);
        try {
          let zipBase64: string | undefined;
          if (y.cachTao === "zip" && y.zip) {
            setDangDoc(true);
            zipBase64 = await docBase64(y.zip).finally(() => setDangDoc(false));
          }
          const r = await taoM.mutateAsync({
            ten: y.ten,
            cachTao: y.cachTao === "mo-ta" ? "rong" : y.cachTao,
            ...(y.khuon ? { khuon: y.khuon } : {}),
            ...(zipBase64 ? { zipBase64 } : {}),
            ...(y.nguonGit ? { nguonGit: y.nguonGit } : {}),
          });
          if (!r.ok || !r.id) {
            setLoiTao(cauChoMaLoiCaNhan(r.ma ?? "KHAC", t));
            return;
          }
          // Làm tươi TRƯỚC khi chọn: selectBox của trang chỉ giữ id có trong `listProjects`.
          await lamTuoi();
          if (r.boQua.length > 0) {
            toast.warning(t("repoWs.duanCaNhan.boQua", "Đã bỏ qua {{n}} tệp không được phép (tệp chạy được / bí mật / .git / node_modules).", { n: r.boQua.length }));
          } else {
            toast.success(t("repoWs.duanCaNhan.daTao", "Đã tạo dự án — đang mở."));
          }
          onChonDuAn?.(r.id);
          if (y.cachTao === "mo-ta" && y.moTa) onTaoTuMoTa?.(r.id, y.moTa);
          onXong?.();
        } catch (e) {
          setLoiTao(cauChoMaLoiCaNhan("GUI_THAT_BAI", t) + ` ${mapTrpcError(e)}`);
        }
      }}
      onDoiTen={(id, ten) => doiTenM.mutate({ id, ten })}
      onXoa={(id) => {
        if (window.confirm(t("repoWs.duanCaNhan.hoiXoa", "Xoá dự án này? Thư mục được chuyển vào thùng rác và xoá hẳn sau 30 ngày."))) {
          xoaM.mutate({ id });
        }
      }}
      onChon={(id) => {
        onChonDuAn?.(id);
        onXong?.();
      }}
    />
  );
}
