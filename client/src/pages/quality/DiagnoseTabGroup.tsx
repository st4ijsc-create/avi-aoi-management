/**
 * doc 59 Cụm F — "Diagnose" nested tab-group cho QualityCockpit: đặt điều tra (RCA ·
 * dự đoán lỗi · đồ thị nhân quả · tương quan) NGAY CẠNH bằng chứng SPC/Pareto, thay vì
 * rải ở 4 route riêng dưới nhóm Analytics. Nhúng 4 *Content sẵn có (ADDITIVE: KHÔNG
 * redirect route cũ, KHÔNG đổi guard cockpit ⇒ user diagnose-only vẫn dùng route standalone,
 * tránh RBAC-regression critic cảnh báo). Inner tab dùng state riêng (không đụng ?tab= của
 * cockpit); deep-link vào cả nhóm qua ?tab=diagnose.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, TrendingUp, GitBranch, Activity } from "lucide-react";
import { RootCauseAnalysisPageContent } from "@/pages/RootCauseAnalysisPage";
import { DefectPredictionPageContent } from "@/pages/DefectPredictionPage";
import { CausalGraphEditorPageContent } from "@/pages/CausalGraphEditorPage";
import { CorrelationAnalysisContent } from "@/pages/CorrelationAnalysis";

const INNER = [
  { value: "rca", labelKey: "quality.diagnose.rca", fallback: "Phân tích nguyên nhân", icon: <Search className="h-4 w-4" />, Content: RootCauseAnalysisPageContent },
  { value: "prediction", labelKey: "quality.diagnose.prediction", fallback: "Dự đoán lỗi", icon: <TrendingUp className="h-4 w-4" />, Content: DefectPredictionPageContent },
  { value: "causal", labelKey: "quality.diagnose.causal", fallback: "Đồ thị nhân quả", icon: <GitBranch className="h-4 w-4" />, Content: CausalGraphEditorPageContent },
  { value: "correlation", labelKey: "quality.diagnose.correlation", fallback: "Tương quan", icon: <Activity className="h-4 w-4" />, Content: CorrelationAnalysisContent },
] as const;

export function DiagnoseTabGroup() {
  const { t } = useTranslation();
  const [inner, setInner] = useState<string>(INNER[0].value);
  return (
    <Tabs value={inner} onValueChange={setInner} className="space-y-3">
      <TabsList className="flex h-9 flex-wrap">
        {INNER.map((it) => (
          <TabsTrigger key={it.value} value={it.value} className="h-7 gap-1.5 text-xs">
            {it.icon}
            {t(it.labelKey, it.fallback)}
          </TabsTrigger>
        ))}
      </TabsList>
      {INNER.map((it) => (
        <TabsContent key={it.value} value={it.value} className="mt-2">
          <it.Content />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default DiagnoseTabGroup;
