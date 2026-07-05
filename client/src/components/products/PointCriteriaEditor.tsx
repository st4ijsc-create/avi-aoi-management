// Doc 31 MP6 (decision #2) — structured pass/fail criteria editor for a
// measurement point. Mirrors the server `criteriaItemSchema` (numeric_range /
// boolean_check / text_match). Criteria are evaluated at ingest by
// server/services/pointResultEvaluator.ts — a violated criterion downgrades a
// machine "OK" to "NG". Kept dependency-light + fully controlled.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

export type PointCriteriaItem =
  | { kind: "numeric_range"; metric: string; min?: string; max?: string; unit?: string }
  | { kind: "boolean_check"; metric: string; expected: boolean }
  | { kind: "text_match"; metric: string; expected: string; mode?: "exact" | "contains" | "regex" };

interface Props {
  value: PointCriteriaItem[];
  onChange: (items: PointCriteriaItem[]) => void;
  disabled?: boolean;
}

const KNOWN_METRICS = [
  "value", "height", "area", "volume", "voidPct", "coplanarity",
  "warpage", "offsetX", "offsetY", "tilt", "thickness",
];

export function PointCriteriaEditor({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const items = Array.isArray(value) ? value : [];

  const update = (idx: number, next: PointCriteriaItem) => {
    const copy = items.slice();
    copy[idx] = next;
    onChange(copy);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...items, { kind: "numeric_range", metric: "value", min: "", max: "" }]);

  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("measurementPointP2.criteriaTitle")}</Label>
        {!disabled && (
          <Button type="button" size="sm" variant="outline" onClick={add}>
            <Plus className="h-3 w-3 mr-1" />
            {t("measurementPointP2.criteriaAdd")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("measurementPointP2.criteriaHelp")}</p>

      {items.length === 0 && (
        <div className="text-xs text-muted-foreground italic">{t("measurementPointP2.criteriaEmpty")}</div>
      )}

      {items.map((c, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-end border-t pt-2">
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.criteriaKind")}</Label>
            <Select
              value={c.kind}
              onValueChange={(kind) => {
                if (kind === "numeric_range") update(idx, { kind, metric: c.metric, min: "", max: "" });
                else if (kind === "boolean_check") update(idx, { kind, metric: c.metric, expected: true });
                else update(idx, { kind: "text_match", metric: c.metric, expected: "", mode: "exact" });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="numeric_range">{t("measurementPointP2.criteriaNumeric")}</SelectItem>
                <SelectItem value="boolean_check">{t("measurementPointP2.criteriaBoolean")}</SelectItem>
                <SelectItem value="text_match">{t("measurementPointP2.criteriaText")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.criteriaMetric")}</Label>
            <Input
              className="h-8"
              list="mp-criteria-metrics"
              value={c.metric}
              placeholder="height"
              onChange={(e) => update(idx, { ...c, metric: e.target.value })}
              disabled={disabled}
            />
          </div>

          {c.kind === "numeric_range" && (
            <>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{t("measurementPointP2.criteriaMin")}</Label>
                <Input className="h-8" value={c.min ?? ""} onChange={(e) => update(idx, { ...c, min: e.target.value })} disabled={disabled} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{t("measurementPointP2.criteriaMax")}</Label>
                <Input className="h-8" value={c.max ?? ""} onChange={(e) => update(idx, { ...c, max: e.target.value })} disabled={disabled} />
              </div>
            </>
          )}

          {c.kind === "boolean_check" && (
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">{t("measurementPointP2.criteriaExpected")}</Label>
              <Select
                value={c.expected ? "true" : "false"}
                onValueChange={(v) => update(idx, { ...c, expected: v === "true" })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {c.kind === "text_match" && (
            <>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{t("measurementPointP2.criteriaMode")}</Label>
                <Select
                  value={c.mode ?? "exact"}
                  onValueChange={(v) => update(idx, { ...c, mode: v as "exact" | "contains" | "regex" })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">exact</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="regex">regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{t("measurementPointP2.criteriaExpected")}</Label>
                <Input className="h-8" value={c.expected} onChange={(e) => update(idx, { ...c, expected: e.target.value })} disabled={disabled} />
              </div>
            </>
          )}

          <div className="col-span-1">
            {!disabled && (
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => remove(idx)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <datalist id="mp-criteria-metrics">
        {KNOWN_METRICS.map((m) => <option key={m} value={m} />)}
      </datalist>
    </div>
  );
}

export default PointCriteriaEditor;
