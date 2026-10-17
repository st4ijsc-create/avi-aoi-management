/**
 * ★★★ Đợt 3c (2026-10-17) — BẢNG "CHẠY & XEM TRƯỚC" (thuần hiển thị + callback, cùng khuôn `BangTerminal`).
 *
 * ⚠ 0 MUTATION trong thành phần: mọi hành động là callback về khung chứa (`KhungChayUngDung`) — nên lưới dựng được
 *   CÂY THẬT bằng `renderToStaticMarkup` (`bangChayUngDung.unit.test.ts`).
 *   • "Cài phụ thuộc" ⇒ `onCai(lenh)` ⇒ khung gọi `aiChayUngDung.deXuatLenh` ⇒ THẺ DUYỆT HITL như mọi lệnh. Bảng chỉ
 *     hiện các lệnh MÁY CHỦ gợi ý (`goiYCai`, suy từ manifest) — không có ô nhập lệnh cài tự do ở đây.
 *   • Chạy/Dừng ⇒ `onChay`/`onDung`; máy chủ kiểm quyền + chủ sở hữu.
 *
 * ⚠⚠ KHUNG XEM TRƯỚC — `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"`:
 *   `src` là `/api/ai/preview/<id>/` (cùng origin ứng dụng ⇒ cookie phiên đi kèm ĐÚNG MỘT lần tới tuyến cấp vé) rồi
 *   302 sang ORIGIN RIÊNG của proxy. `allow-same-origin` ở đây nghĩa là "origin của proxy" (cần để cookie RIÊNG của
 *   proxy đi kèm tài nguyên con), KHÁC origin cha ⇒ không gỡ được sandbox, không chạm DOM/phiên ứng dụng. Xem khối an
 *   ninh ở `server/services/ai/chayUngDung/proxyXemTruoc.ts`. KHÔNG có `allow-top-navigation`: mã xem trước không
 *   được điều hướng trang ứng dụng.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TrangThaiUngDung = "dang-khoi-dong" | "dang-chay" | "dang-dung" | "da-dung" | "loi";

/** Hình dạng `aiChayUngDung.trangThai` khi `ok` (mirror — giá trị đến từ máy chủ). */
export interface DuLieuBangChay {
  ungDung:
    | {
        laChu: true;
        cong: number | null;
        trangThai: TrangThaiUngDung;
        lenh: string;
        maThoat: number | null;
        lyDoDung: "nguoi-dung" | "nhan-roi" | "tat-may" | "nghe-sai-dia-chi" | null;
        chuaXacNhanChet: boolean;
        chuaNgheCong: boolean;
      }
    | { laChu: false; dangBan: boolean }
    | null;
  lenhChay: { ok: true; moTa: string; nguon: string } | { ok: false; ma: string; chiTiet: string };
  goiYCai: string[];
  xemTruoc: { bat: boolean; lyDoTat: string | null };
}

export const SANDBOX_XEM_TRUOC = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

/**
 * ★★★ Vá cookie-tossing (rà f4b504dc5): máy chủ TẮT xem trước khi origin proxy không KHÁC SITE với ứng dụng (cookie
 * không tách theo cổng). Các mã này ⇒ câu cấu hình riêng (AI_PREVIEW_PUBLIC_ORIGIN=http://127.0.0.2:<cổng>).
 */
const LY_DO_CAN_HOST_RIENG = new Set(["THIEU_ORIGIN_RIENG", "ORIGIN_CUNG_SITE", "ORIGIN_KHONG_HOP_LE"]);

/**
 * URL vào xem trước: tuyến cấp vé của ứng dụng (đường TƯƠNG ĐỐI). ⚠ Client KHÔNG BAO GIỜ tự dựng origin xem trước từ
 * host hiện tại: tuyến cấp vé 302 sang `AI_PREVIEW_PUBLIC_ORIGIN` do MÁY CHỦ cấu hình và kiểm khác site.
 */
export function urlXemTruoc(projectId: string): string {
  return `/api/ai/preview/${encodeURIComponent(projectId)}/`;
}

interface Props {
  projectId: string;
  duLieu: DuLieuBangChay | null;
  nhatKy: { dong: string[]; catDau: boolean } | null;
  dangBan: boolean;
  onCai: (lenh: string) => void;
  onChay: () => void;
  onDung: () => void;
}

export function BangChayUngDung({ projectId, duLieu, nhatKy, dangBan, onCai, onChay, onDung }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const ud = duLieu?.ungDung ?? null;
  const cuaToi = ud && ud.laChu ? ud : null;
  const song = !!cuaToi && (cuaToi.trangThai === "dang-khoi-dong" || cuaToi.trangThai === "dang-chay" || cuaToi.trangThai === "dang-dung");
  const nguoiKhacBan = !!ud && !ud.laChu && ud.dangBan;
  const coTheChay = !!duLieu && duLieu.lenhChay.ok && !song && !nguoiKhacBan && !dangBan;
  const hienKhung = !!cuaToi && cuaToi.trangThai === "dang-chay" && !!duLieu?.xemTruoc.bat;

  const nhanTrangThai = !cuaToi
    ? t("repoWs.chayUD.trangThai.chuaChay")
    : cuaToi.trangThai === "loi"
      ? t("repoWs.chayUD.trangThai.loi", { ma: cuaToi.maThoat ?? "?" })
      : t(`repoWs.chayUD.trangThai.${cuaToi.trangThai}`);

  return (
    <div className="flex flex-col gap-2 text-xs" data-bang="chay-ung-dung">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-trang-thai={cuaToi?.trangThai ?? "chua-chay"}
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            cuaToi?.trangThai === "dang-chay" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : cuaToi?.trangThai === "loi" ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          {nhanTrangThai}
        </span>
        {cuaToi?.cong != null && <span className="tabular-nums text-muted-foreground">{t("repoWs.chayUD.cong", { cong: cuaToi.cong })}</span>}
        {cuaToi?.lyDoDung && cuaToi.trangThai === "da-dung" && (
          <span className="text-muted-foreground">({t(`repoWs.chayUD.lyDoDung.${cuaToi.lyDoDung}`)})</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(duLieu?.goiYCai ?? []).map((lenh) => (
            <Button key={lenh} type="button" size="sm" variant="outline" data-nut="cai" data-lenh={lenh} disabled={dangBan} title={t("repoWs.chayUD.caiTip")} onClick={() => onCai(lenh)}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {t("repoWs.chayUD.caiPhuThuoc")}: <code className="ml-1">{lenh}</code>
            </Button>
          ))}
          {song ? (
            <Button type="button" size="sm" variant="destructive" data-nut="dung" disabled={dangBan || cuaToi?.trangThai === "dang-dung"} onClick={onDung}>
              <Square className="mr-1 h-3.5 w-3.5" />
              {t("repoWs.chayUD.dung")}
            </Button>
          ) : (
            <Button type="button" size="sm" data-nut="chay" disabled={!coTheChay} onClick={onChay}>
              {dangBan ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {t("repoWs.chayUD.chay")}
            </Button>
          )}
        </div>
      </div>

      {duLieu && duLieu.goiYCai.length === 0 && <p className="text-muted-foreground">{t("repoWs.chayUD.khongCoLenhCai")}</p>}
      {duLieu &&
        (duLieu.lenhChay.ok ? (
          <p className="text-muted-foreground" data-lenh-chay>
            {t("repoWs.chayUD.lenhChay", { lenh: duLieu.lenhChay.moTa, nguon: duLieu.lenhChay.nguon })} · {t("repoWs.chayUD.nhanRoi")}
          </p>
        ) : duLieu.lenhChay.ma === "REPO_CHINH_KHONG_CHAY" ? (
          <p className="text-amber-700 dark:text-amber-300" data-loi-chay="REPO_CHINH_KHONG_CHAY">{t("repoWs.chayUD.repoChinh")}</p>
        ) : (
          <p className="text-amber-700 dark:text-amber-300" data-loi-chay={duLieu.lenhChay.ma}>
            {t("repoWs.chayUD.khongChayDuoc", { ma: duLieu.lenhChay.ma, chiTiet: duLieu.lenhChay.chiTiet })}
          </p>
        ))}
      {nguoiKhacBan && <p className="text-amber-700 dark:text-amber-300">{t("repoWs.chayUD.nguoiKhacDangChay")}</p>}
      {cuaToi?.chuaNgheCong && <p className="text-amber-700 dark:text-amber-300" data-canh-bao="chua-nghe-cong">{t("repoWs.chayUD.chuaNgheCong", { cong: cuaToi.cong ?? "?" })}</p>}
      {cuaToi?.chuaXacNhanChet && <p className="text-red-700 dark:text-red-300" data-canh-bao="chua-xac-nhan-chet">{t("repoWs.chayUD.chuaXacNhanChet")}</p>}

      <section aria-label={t("repoWs.chayUD.nhatKy")}>
        <div className="mb-1 font-medium">{t("repoWs.chayUD.nhatKy")}</div>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]" data-nhat-ky>
          {nhatKy && nhatKy.dong.length > 0
            ? (nhatKy.catDau ? t("repoWs.chayUD.nhatKyCat") + "\n" : "") + nhatKy.dong.join("\n")
            : t("repoWs.chayUD.nhatKyRong")}
        </pre>
      </section>

      <section aria-label={t("repoWs.chayUD.xemTruoc")} className="flex min-h-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t("repoWs.chayUD.xemTruoc")}</span>
          {hienKhung && (
            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={urlXemTruoc(projectId)} target="_blank" rel="noopener noreferrer" data-nut="tab-moi">
              <ExternalLink className="h-3.5 w-3.5" />
              {t("repoWs.chayUD.moTabMoi")}
            </a>
          )}
        </div>
        {duLieu && !duLieu.xemTruoc.bat ? (
          LY_DO_CAN_HOST_RIENG.has(String(duLieu.xemTruoc.lyDoTat)) ? (
            <p className="text-amber-700 dark:text-amber-300" data-xem-truoc="can-host-rieng">
              {t("repoWs.chayUD.xemTruocCanHostRieng", { lyDo: duLieu.xemTruoc.lyDoTat ?? "?" })}
            </p>
          ) : (
            <p className="text-muted-foreground" data-xem-truoc="tat">{t("repoWs.chayUD.xemTruocTat", { lyDo: duLieu.xemTruoc.lyDoTat ?? "?" })}</p>
          )
        ) : hienKhung ? (
          <>
            <p className="text-[11px] text-muted-foreground">{t("repoWs.chayUD.xemTruocAnToan")}</p>
            <iframe
              title={t("repoWs.chayUD.xemTruoc")}
              src={urlXemTruoc(projectId)}
              sandbox={SANDBOX_XEM_TRUOC}
              referrerPolicy="no-referrer"
              className="h-80 w-full rounded border bg-white"
              data-khung-xem-truoc
            />
          </>
        ) : (
          <p className="text-muted-foreground">{t("repoWs.chayUD.xemTruocCho")}</p>
        )}
      </section>
    </div>
  );
}
