/**
 * ★★ Đợt 9 — thẻ "KIỂM BIÊN DỊCH ST" của màn lập trình (trợ lý + Cmd+K). Nhận sự kiện SSE `kiem_bien_dich`:
 *   • `dang-kiem` ⇒ chỉ báo tiến trình ("đang biên dịch thử…");
 *   • `xong` ⇒ nhãn theo kết cục — "biên dịch sạch" / "đã tự sửa K lỗi" (+ nút xem BẢN ĐẦU) / "còn N lỗi: …" / "chưa kiểm được".
 * Không thay lặng lẽ: bản đã sửa luôn đi kèm nhãn + bản đầu. Nhãn do CLIENT dựng từ số liệu ⇒ đủ vi/en/zh.
 * Cờ `AI_KIEM_BIEN_DICH_ST` tắt ⇒ server không phát gì ⇒ thẻ không bao giờ hiện.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";
import type { KbKiemBienDich } from "@/hooks/useKbChatStream";

export function KiemBienDichCard({ kiem }: { kiem: KbKiemBienDich | null }) {
  const { t } = useTranslation();
  const [xemDau, setXemDau] = useState(false);
  if (!kiem) return null;
  if (kiem.phase === "dang-kiem" || !kiem.ketQua) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] text-muted-foreground" data-testid="kiem-bien-dich" data-trang-thai="dang-kiem" role="status">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {t("repoWs.kiemBienDich.dangKiem", "Đang biên dịch thử mã ST (RuSTy)…")}
      </div>
    );
  }
  const k = kiem.ketQua;
  const soLoi = k.chanDoan.length;
  return (
    <div className="space-y-1 rounded-md border px-2 py-1.5 text-[12px]" data-testid="kiem-bien-dich" data-trang-thai={k.trangThai}>
      {k.trangThai === "sach" && (
        <p className="flex items-center gap-1.5 text-emerald-600">
          <Check className="h-3 w-3 shrink-0" aria-hidden />
          {t("repoWs.kiemBienDich.sach", "Biên dịch sạch (RuSTy): không lỗi.")}
        </p>
      )}
      {k.trangThai === "da-sua" && (
        <>
          <p className="flex items-center gap-1.5 text-emerald-600">
            <Check className="h-3 w-3 shrink-0" aria-hidden />
            {t("repoWs.kiemBienDich.daSua", "Đã tự sửa {{k}} lỗi biên dịch (RuSTy) sau {{v}} vòng — bản hiển thị là bản đã sửa.", { k: k.soLoiDaSua, v: k.soVong })}
          </p>
          {k.cauTraLoiDau ? (
            <>
              <button type="button" onClick={() => setXemDau(!xemDau)} aria-expanded={xemDau} data-testid="kiem-bien-dich-xem-dau" className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                {xemDau ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
                {t("repoWs.kiemBienDich.xemBanDau", "Xem bản đầu (trước khi sửa)")}
              </button>
              {xemDau && <pre data-testid="kiem-bien-dich-ban-dau" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">{k.cauTraLoiDau.slice(0, 12000)}</pre>}
            </>
          ) : null}
        </>
      )}
      {k.trangThai === "con-loi" && (
        <>
          <p className="flex items-center gap-1.5 text-amber-600">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            {t("repoWs.kiemBienDich.conLoi", "Mã ST còn {{n}} lỗi biên dịch (RuSTy) sau {{v}} vòng tự sửa:", { n: soLoi, v: k.soVong })}
          </p>
          <ul className="space-y-0.5 font-mono text-[11px]" data-testid="kiem-bien-dich-loi">
            {k.chanDoan.map((d, i) => (
              // i18n-raw-ok: thông điệp của trình biên dịch RuSTy (tiếng Anh, theo dòng) — dữ liệu kỹ thuật, không dịch.
              <li key={i} className="break-words">
                {d.tep ?? "?"}:{d.dong ?? "?"}:{d.cot ?? "?"} {d.ma ? `error[${d.ma}]` : "error"}: {d.thongDiep}
              </li>
            ))}
          </ul>
          {k.cauTraLoiDau ? (
            <>
              <button type="button" onClick={() => setXemDau(!xemDau)} aria-expanded={xemDau} data-testid="kiem-bien-dich-xem-dau" className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                {xemDau ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
                {t("repoWs.kiemBienDich.xemBanDau", "Xem bản đầu (trước khi sửa)")}
              </button>
              {xemDau && <pre data-testid="kiem-bien-dich-ban-dau" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">{k.cauTraLoiDau.slice(0, 12000)}</pre>}
            </>
          ) : null}
        </>
      )}
      {k.trangThai === "khong-kiem-duoc" && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" aria-hidden />
          {/* i18n-raw-ok: lý do hạ tầng (docker/ảnh vắng…) là chuỗi kỹ thuật của máy chủ, hiện kèm câu đã dịch. */}
          {t("repoWs.kiemBienDich.khongKiemDuoc", "Chưa kiểm biên dịch được ({{lyDo}}).", { lyDo: k.lyDo ?? "—" })}
        </p>
      )}
    </div>
  );
}
