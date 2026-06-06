/**
 * useAnalyticsBatch Hook
 * Batches multiple tRPC queries and executes them in parallel
 * Returns combined results with loading states
 */

import { useCallback, useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export interface AnalyticsQueryParams {
  startDate: string;
  endDate: string;
  machineId?: number;
  factoryCode?: string;
  lineCode?: string;
  productModel?: string;
}

export interface AnalyticsBatchResult {
  trend: any;
  pareto: any;
  machPerf: any;
  forecast: any;
  risk: any;
  control: any;
  shift: any;
  heatmap: any;
  corr: any;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Execute all analytics queries in parallel batch mode
 * Memoizes results and provides unified loading/error states
 */
export function useAnalyticsBatch(
  params: AnalyticsQueryParams,
  enabledTabs: Record<string, boolean> = {}
): AnalyticsBatchResult {
  // Query all analytics endpoints in parallel
  const trend = trpc.aiInspectionAnalytics.defectTrend.useQuery(params);
  const pareto = trpc.aiInspectionAnalytics.defectPareto.useQuery(params);
  const machPerf = trpc.aiInspectionAnalytics.machinePerformance.useQuery(params, {
    enabled: enabledTabs['machines'] ?? true,
  });
  const forecast = trpc.aiInspectionAnalytics.yieldForecast.useQuery(
    { ...params, horizonDays: 7 },
    { enabled: enabledTabs['forecast'] ?? false }
  );
  const risk = trpc.aiInspectionAnalytics.riskAssessment.useQuery(params, {
    enabled: enabledTabs['risk'] ?? false,
  });
  const control = trpc.aiInspectionAnalytics.controlChart.useQuery(
    { ...params, metric: 'yield' },
    { enabled: enabledTabs['spc'] ?? false }
  );
  const shift = trpc.aiInspectionAnalytics.shiftAnalysis.useQuery(params, {
    enabled: enabledTabs['trend'] ?? false,
  });
  const heatmap = trpc.aiInspectionAnalytics.defectHeatmap.useQuery(params, {
    enabled: enabledTabs['trend'] ?? false,
  });
  const corr = trpc.aiInspectionAnalytics.correlations.useQuery(params, {
    enabled: enabledTabs['machines'] ?? false,
  });

  // Compute combined loading state
  const isLoading = useMemo(
    () =>
      trend.isLoading ||
      pareto.isLoading ||
      machPerf.isLoading ||
      forecast.isLoading ||
      risk.isLoading ||
      control.isLoading ||
      shift.isLoading ||
      heatmap.isLoading ||
      corr.isLoading,
    [
      trend.isLoading,
      pareto.isLoading,
      machPerf.isLoading,
      forecast.isLoading,
      risk.isLoading,
      control.isLoading,
      shift.isLoading,
      heatmap.isLoading,
      corr.isLoading,
    ]
  );

  // Compute combined error state
  const isError = useMemo(
    () =>
      trend.isError ||
      pareto.isError ||
      machPerf.isError ||
      forecast.isError ||
      risk.isError ||
      control.isError ||
      shift.isError ||
      heatmap.isError ||
      corr.isError,
    [
      trend.isError,
      pareto.isError,
      machPerf.isError,
      forecast.isError,
      risk.isError,
      control.isError,
      shift.isError,
      heatmap.isError,
      corr.isError,
    ]
  );

  // Refetch all queries
  const refetch = useCallback(() => {
    trend.refetch();
    pareto.refetch();
    machPerf.refetch();
    forecast.refetch();
    risk.refetch();
    control.refetch();
    shift.refetch();
    heatmap.refetch();
    corr.refetch();
  }, [trend, pareto, machPerf, forecast, risk, control, shift, heatmap, corr]);

  return {
    trend,
    pareto,
    machPerf,
    forecast,
    risk,
    control,
    shift,
    heatmap,
    corr,
    isLoading,
    isError,
    refetch,
  };
}
