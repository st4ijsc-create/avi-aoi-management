/**
 * R4 — huy hiệu KIỂM MÁY sau nạp (`kb_ingest_jobs."ketQuaMay"`, server/services/kbKiemSauNap.ts).
 * Ba trạng thái KHÁC NHAU, không gộp: `null` = chưa từng kiểm (hàng cũ) ⇒ "—"; `canhBao: []` = đã kiểm,
 * ổn; có cảnh báo ⇒ mỗi mã một huy hiệu đỏ/vàng, lý do trong tooltip (không bắt người dùng đọc hướng dẫn).
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { KetQuaMayNap } from "../../../../server/services/kbKiemSauNap";

export type { KetQuaMayNap };

export function HuyHieuKiemMay({ kq }: { kq: KetQuaMayNap | null | undefined }) {
  const { t } = useTranslation();
  if (!kq) {
    return (
      <span className="text-muted-foreground" title={t("kbStudio.kiemMay.chuaKiemHint")} data-kiem-may="chua">
        —
      </span>
    );
  }
  if (kq.canhBao.length === 0) {
    return (
      <Badge variant="outline" className="status-ok" data-kiem-may="on" title={t("kbStudio.kiemMay.onHint")}>
        {t("kbStudio.kiemMay.on")}
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {kq.canhBao.map((c) => (
        <Badge
          key={c.ma}
          variant="outline"
          className={c.muc === "do" ? "status-ng" : "status-ntf"}
          data-kiem-may={c.ma}
          title={
            t(`kbStudio.kiemMay.lyDo.${c.ma}`, { trang: kq.soTrang ?? "?", kyTu: kq.kyTuMoiTrang ?? "?", ocr: kq.ocrSoTrang ?? 0 }) +
            // R4 — VÌ SAO OCR không chạy, nói đúng khoá cần sửa (vd PDFTOPPM_BIN trống).
            (c.ma === "pdf-quet-khong-ocr" && kq.ocrLyDo ? ` ${t(`kbStudio.kiemMay.ocrLyDo.${kq.ocrLyDo}`)}` : "")
          }
        >
          {t(`kbStudio.kiemMay.ma.${c.ma}`)}
        </Badge>
      ))}
    </span>
  );
}

/** "3 trang · 3.000 ký tự/trang · 6 đoạn" — số liệu nạp thật, `null` ⇒ bỏ phần đó. */
export function tomTatNap(kq: KetQuaMayNap | null | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!kq) return "";
  const phan: string[] = [];
  if (kq.soTrang !== null) phan.push(t("kbStudio.kiemMay.soTrang", { n: kq.soTrang }));
  if (kq.kyTuMoiTrang !== null) phan.push(t("kbStudio.kiemMay.kyTuMoiTrang", { n: kq.kyTuMoiTrang.toLocaleString() }));
  phan.push(t("kbStudio.kiemMay.soDoan", { n: kq.soDoan }));
  return phan.join(" · ");
}
