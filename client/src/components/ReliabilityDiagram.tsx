/**
 * B2 — Reliability Diagram.
 *
 * Renders the calibration reliability diagram: per-bin accuracy bars against the
 * ideal y=x line (perfect calibration). A point/bar above the line ⇒ under-confident,
 * below ⇒ over-confident. Pure presentational component (no data fetching).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface ReliabilityBin {
  binLower: number;
  binUpper: number;
  avgConfidence: number;
  accuracy: number;
  count: number;
}

interface ReliabilityDiagramProps {
  bins: ReliabilityBin[];
  height?: number;
}

export function ReliabilityDiagram({ bins, height = 320 }: ReliabilityDiagramProps) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      bins.map((b) => {
        const mid = (b.binLower + b.binUpper) / 2;
        return {
          bin: `${(b.binLower * 100).toFixed(0)}-${(b.binUpper * 100).toFixed(0)}%`,
          midpoint: mid,
          // y=x ideal line uses the bin midpoint as the target confidence.
          ideal: Number(mid.toFixed(4)),
          accuracy: Number(b.accuracy.toFixed(4)),
          avgConfidence: Number(b.avgConfidence.toFixed(4)),
          count: b.count,
        };
      }),
    [bins],
  );

  if (!bins || bins.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t('calibration.noBins', 'Chưa có dữ liệu reliability bins')}
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bin" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
          <RTooltip
            formatter={(value: number, name: string) => {
              if (name === 'count') return [value, t('calibration.count', 'Số mẫu')];
              return [`${(Number(value) * 100).toFixed(1)}%`, name];
            }}
          />
          <Legend />
          <Bar
            dataKey="accuracy"
            name={t('calibration.accuracy', 'Độ chính xác (bin)')}
            fill="#3b82f6"
            barSize={22}
          />
          <Line
            type="linear"
            dataKey="ideal"
            name={t('calibration.idealLine', 'Lý tưởng (y = x)')}
            stroke="#ef4444"
            strokeDasharray="5 5"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="avgConfidence"
            name={t('calibration.avgConfidence', 'Độ tin cậy TB')}
            stroke="#10b981"
            dot={{ r: 3 }}
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ReliabilityDiagram;
