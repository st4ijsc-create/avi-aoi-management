/**
 * R1b-2b-2b B-T7 — chip "Truyền thông n/m" ở đầu trang SCADA (M10 + ngăn tag). Nguồn: `scadaDiag.tomTatTruyenThong` (hợp đồng C2):
 * `tong` = adapter BẬT do trung tâm sở hữu trong phạm vi; adapter do edge sở hữu đếm RIÊNG (`edge`) và KHÔNG vào mẫu số.
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
  const chu = d.edge > 0 ? t("scada.truyenThong.chip.coEdge", { ketNoi: d.ketNoi, tong: d.tong, edge: d.edge }) : t("scada.truyenThong.chip.nhan", { ketNoi: d.ketNoi, tong: d.tong });
  return (
    <Link
      href="/scada/diag"
      data-testid="chip-truyen-thong"
      data-tone={tone}
      title={t("scada.truyenThong.chip.moTa", { dangNoi: d.dangNoi, mat: d.mat, khac: d.khac })}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums"
      style={{ color: mau }}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: mau }} aria-hidden="true" />
      {chu}
    </Link>
  );
}
