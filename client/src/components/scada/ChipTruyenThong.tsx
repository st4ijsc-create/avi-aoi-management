/**
 * R1b-2b-2b B-T7 — chip "Truyền thông N nối · M tắt" ở đầu trang SCADA (M10 + ngăn tag). Nguồn: `scadaDiag.tomTatTruyenThong` (hợp đồng C2, KHÔNG đổi):
 * `tong` = adapter có cờ is_enabled do trung tâm sở hữu trong phạm vi; adapter do edge sở hữu đếm RIÊNG (`edge`). Chip hiện `ketNoi` ("nối") và `khac` ("tắt" hoặc chưa rõ), kèm nối lại / mất / edge khi > 0.
 * Đang tải / lỗi / không có adapter nào ⇒ không hiện (chip chỉ là tóm tắt, không được làm vỡ trang). Bấm ⇒ M10.
 * Màu chỉ lấy token ISA có sẵn; màu không phải kênh duy nhất (chữ n/m + chấm).
 */
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { BIEN_MAU_GACH_TIM, BIEN_MAU_TONE } from "./chatLuongHienThi";

const CHU_KY_MS = 15_000;

export function ChipTruyenThong() {
  const { t } = useTranslation();
  const q = trpc.scadaDiag.tomTatTruyenThong.useQuery(undefined, { refetchInterval: CHU_KY_MS, retry: false });
  const d = q.data;
  if (q.isLoading || q.isError || !d) return null;
  if (d.tong === 0 && d.edge === 0) return null;
  const tone = d.mat > 0 ? "mat" : d.dangNoi > 0 ? "dang_noi" : "trung_tinh";
  const mau = `var(${tone === "mat" ? BIEN_MAU_GACH_TIM : tone === "dang_noi" ? BIEN_MAU_TONE.warn : BIEN_MAU_TONE.ok})`;
  // Hiện CẢ HAI trạng thái: "N nối · M tắt"; nối lại / mất / edge chỉ hiện khi > 0 (chủ dự án 2026-11-04: "0/15" khiến 15 adapter "Đã tắt" trông như 15 adapter bật).
  const chu = [
    t("scada.truyenThong.chip.nhan", { ketNoi: d.ketNoi, khac: d.khac }),
    d.dangNoi > 0 ? t("scada.truyenThong.chip.dangNoi", { dangNoi: d.dangNoi }) : null,
    d.mat > 0 ? t("scada.truyenThong.chip.mat", { mat: d.mat }) : null,
    d.edge > 0 ? t("scada.truyenThong.chip.edge", { edge: d.edge }) : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");
  return (
    <Link
      href="/scada/diag"
      data-testid="chip-truyen-thong"
      data-tone={tone}
      title={t("scada.truyenThong.chip.moTa", { tong: d.tong, ketNoi: d.ketNoi, dangNoi: d.dangNoi, mat: d.mat, khac: d.khac })}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums"
      style={{ color: mau }}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: mau }} aria-hidden="true" />
      {chu}
    </Link>
  );
}
