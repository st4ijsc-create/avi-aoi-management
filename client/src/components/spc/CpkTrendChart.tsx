/**
 * Biểu đồ xu hướng Cpk/Ppk (tách khỏi SPCAnalysis để test): Cpk KHÔNG xác định (dữ liệu hằng ⇒ máy chủ ghi NULL) là `null` — Recharts BỎ thanh,
 * KHÔNG vẽ thanh 0 (0 đọc thành "không đạt"). Có điểm không xác định ⇒ chú giải bên dưới.
 */
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartAxisTick, chartColor, chartGridProps, chartTooltipStyle } from "@/components/patterns";
import { duLieuXuHuongCpk, type DongCpk } from "@/lib/spcCpkTrend";

export function CpkTrendChart({ rows }: { rows: readonly DongCpk[] }) {
  const { t } = useTranslation();
  const { diem, coKhongXacDinh } = duLieuXuHuongCpk(rows);
  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={diem}>
          <CartesianGrid {...chartGridProps} />
          <XAxis dataKey="i" tick={chartAxisTick} />
          <YAxis tick={chartAxisTick} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Legend />
          <ReferenceLine y={1.33} stroke="var(--success)" strokeDasharray="4 2" />
          <ReferenceLine y={1.0} stroke="var(--destructive)" strokeDasharray="4 2" />
          <Bar dataKey="cpk" fill={chartColor(0)} isAnimationActive={false} />
          <Bar dataKey="ppk" fill={chartColor(2)} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      {coKhongXacDinh && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="cpk-khong-xac-dinh">
          {t("spc.cpkKhongXacDinh")}
        </p>
      )}
    </div>
  );
}
