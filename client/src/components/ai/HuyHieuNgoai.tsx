/**
 * Đợt 10.4b (L0b) — NHÃN + HUY HIỆU của MỖI lượt trả lời bằng model ngoài (kế hoạch §D4d). Dữ liệu `vet` do MÁY CHỦ trả (client không tự dựng số); hiển thị cả khi lượt lỗi.
 * Nhãn: "ngoài · gửi dữ liệu ra <nhà cung cấp>"; huy hiệu: "<model> · ~N token · ~$X". Mọi chuỗi từ máy chủ hiển thị bằng nút văn bản.
 */
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";

export interface VetNgoai {
  nhaCungCap: string;
  model: string;
  tokenVao?: number | null;
  tokenRa?: number | null;
  chiPhiUocUsd?: number | null;
}

export function HuyHieuNgoai({ vet, loi }: { vet: VetNgoai; loi?: boolean }) {
  const { t } = useTranslation();
  const tong = (vet.tokenVao ?? 0) + (vet.tokenRa ?? 0);
  const coToken = vet.tokenVao != null || vet.tokenRa != null;
  return (
    <div data-testid="huy-hieu-ngoai" className={`mt-1 flex flex-wrap items-center gap-1.5 text-[11px] ${loi ? "text-red-700" : "text-muted-foreground"}`}>
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span data-testid="nhan-ngoai" className="rounded border border-amber-500 px-1 text-amber-700">
        {t("noiDungNgoai.nhan", "ngoài")} · {t("noiDungNgoai.guiDuLieuRa", "gửi dữ liệu ra")} {vet.nhaCungCap}
      </span>
      <span data-testid="vet-ngoai">
        {vet.model}
        {coToken ? ` · ~${tong.toLocaleString("vi-VN")} token` : ""}
        {vet.chiPhiUocUsd != null ? ` · ~$${vet.chiPhiUocUsd.toFixed(4)}` : ""}
      </span>
    </div>
  );
}
