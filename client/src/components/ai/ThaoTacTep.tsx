/**
 * ★★★ Đợt 3b (3.5) — NÚT TỆP trên cây: Tạo tệp · Tạo thư mục · Đổi tên · Xoá.
 *
 * ⚠ KHÔNG đường ghi mới. Mỗi nút chỉ gọi một callback của TRANG, và trang đi qua đúng luồng ĐỀ XUẤT → THẺ DUYỆT hiện
 *   có: tạo = `deXuatSuaTay` với `original:""` (`apply_diff` tạo mới); đổi tên / xoá = `deXuatDoiTenTep` /
 *   `deXuatXoaTep` (tool `rename_file` / `delete_file`). Byte chỉ đổi sau khi người bấm Xác nhận trên thẻ; máy chủ chạy
 *   lại mọi hàng rào (chính sách đường · hộp cát · băm · git bẩn) lúc Xác nhận.
 * ⚠ "Thư mục" không tồn tại riêng với git ⇒ Tạo thư mục = tạo `<thư mục>/<tệp đầu>` (mặc định `README.md`).
 * ⚠ Kiểm đường ở client là phép lịch sự (bắt lỗi gõ sớm); máy chủ phán lại.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Đường tương đối hợp lệ phía client: không rỗng, không tuyệt đối, không `..`, không ký tự cấm Windows. THUẦN. */
export function kiemDuongTepMoi(x: string): "ok" | "rong" | "tuyet_doi" | "thoat" | "ky_tu" {
  const s = x.trim().replace(/\\/g, "/");
  if (s === "" || s.endsWith("/")) return "rong";
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) return "tuyet_doi";
  if (s.split("/").some((d) => d === ".." || d === "." || d === "")) return "thoat";
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001f]/.test(s)) return "ky_tu";
  return "ok";
}

/** Nối thư mục (có thể rỗng = gốc) với tên. THUẦN. */
export function noiDuong(thuMuc: string | null, ten: string): string {
  const a = (thuMuc ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const b = ten.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return a ? `${a}/${b}` : b;
}

/** Nội dung khởi đầu cho tệp mới (apply_diff từ chối bản rỗng-thành-rỗng ⇒ luôn ≥ 1 ký tự). THUẦN. */
export function noiDungTepMoi(duong: string): string {
  const ten = duong.split("/").pop() ?? duong;
  const duoi = ten.includes(".") ? ten.slice(ten.lastIndexOf(".")).toLowerCase() : "";
  if (duoi === ".md") return `# ${ten.replace(/\.md$/i, "")}\n`;
  if (duoi === ".json") return "{}\n";
  return "\n";
}

type CheDo = null | "tep" | "thuMuc" | "doiTen";

export interface ThaoTacTepProps {
  /** Thư mục của tệp đang chọn ("" = gốc) — nơi tệp/thư mục mới được đặt mặc định. */
  thuMucHienTai: string;
  /** Tệp đang mở (đích của Đổi tên / Xoá); `null` ⇒ hai nút ấy khoá. */
  tepDangChon: string | null;
  /** Người dùng ĐỀ XUẤT ghi được không (lịch sự; máy chủ là hàng rào). */
  coQuyen: boolean;
  dangBan: boolean;
  onTaoTep: (duong: string, noiDung: string) => void;
  onDoiTen: (tu: string, den: string) => void;
  onXoa: (duong: string) => void;
}

export function ThaoTacTep(p: ThaoTacTepProps) {
  const { t } = useTranslation();
  const [cheDo, setCheDo] = useState<CheDo>(null);
  const [o1, setO1] = useState("");
  const [o2, setO2] = useState("README.md");

  const mo = (c: CheDo) => {
    setCheDo(c);
    if (c === "tep") setO1(noiDuong(p.thuMucHienTai, ""));
    if (c === "thuMuc") {
      setO1(noiDuong(p.thuMucHienTai, ""));
      setO2("README.md");
    }
    if (c === "doiTen") setO1(p.tepDangChon ?? "");
  };
  const duongDich = cheDo === "thuMuc" ? noiDuong(o1, o2) : o1;
  const kq = kiemDuongTepMoi(duongDich);
  const khoa = !p.coQuyen || p.dangBan;

  const gui = () => {
    if (kq !== "ok") return;
    const d = duongDich.trim().replace(/\\/g, "/");
    if (cheDo === "tep" || cheDo === "thuMuc") p.onTaoTep(d, noiDungTepMoi(d));
    if (cheDo === "doiTen" && p.tepDangChon && d !== p.tepDangChon) p.onDoiTen(p.tepDangChon, d);
    setCheDo(null);
  };

  return (
    <div data-thao-tac-tep className="flex flex-col gap-1">
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="h-6 w-6" data-nut-tao-tep disabled={khoa} onClick={() => mo("tep")} title={t("repoWs.tep.taoTep")} aria-label={t("repoWs.tep.taoTep")}>
          <FilePlus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" data-nut-tao-thu-muc disabled={khoa} onClick={() => mo("thuMuc")} title={t("repoWs.tep.taoThuMuc")} aria-label={t("repoWs.tep.taoThuMuc")}>
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" data-nut-doi-ten-tep disabled={khoa || !p.tepDangChon} onClick={() => mo("doiTen")} title={t("repoWs.tep.doiTen")} aria-label={t("repoWs.tep.doiTen")}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:text-destructive"
          data-nut-xoa-tep
          disabled={khoa || !p.tepDangChon}
          onClick={() => p.tepDangChon && p.onXoa(p.tepDangChon)}
          title={t("repoWs.tep.xoa")}
          aria-label={t("repoWs.tep.xoa")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {!p.coQuyen && <span className="ml-1 truncate text-[10px] text-muted-foreground">{t("repoWs.tep.thieuQuyen")}</span>}
      </div>
      {cheDo && (
        <form
          data-form-tep={cheDo}
          className="flex flex-col gap-1 rounded-md border bg-muted/40 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            gui();
          }}
        >
          <label className="text-[10px] text-muted-foreground">
            {cheDo === "thuMuc" ? t("repoWs.tep.duongThuMuc") : cheDo === "doiTen" ? t("repoWs.tep.duongMoi") : t("repoWs.tep.duongTep")}
          </label>
          <input
            data-o-duong
            autoFocus
            value={o1}
            onChange={(e) => setO1(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setCheDo(null); }}
            className="h-7 rounded border bg-background px-1.5 font-mono text-[11px]"
          />
          {cheDo === "thuMuc" && (
            <>
              <label className="text-[10px] text-muted-foreground">{t("repoWs.tep.tepDau")}</label>
              <input data-o-tep-dau value={o2} onChange={(e) => setO2(e.target.value)} className="h-7 rounded border bg-background px-1.5 font-mono text-[11px]" />
            </>
          )}
          {kq !== "ok" && o1 !== "" && <p data-loi-duong className="text-[10px] text-destructive">{t(`repoWs.tep.loi.${kq}`)}</p>}
          <p className="text-[10px] text-muted-foreground">{t("repoWs.tep.quaThe")}</p>
          <div className="flex gap-1">
            <Button type="submit" size="sm" className="h-6 px-2 text-[11px]" data-nut-de-xuat disabled={kq !== "ok" || (cheDo === "doiTen" && duongDich.trim() === p.tepDangChon)}>
              {t("repoWs.tep.deXuat")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setCheDo(null)}>
              {t("repoWs.tep.huy")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
