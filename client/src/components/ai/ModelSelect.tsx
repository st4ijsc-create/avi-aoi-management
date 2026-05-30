import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

/**
 * Shared AI model selector — WS-1.
 *
 * Lists models via `aiModel.list` (NOT hard-coded). Value is the model id as a
 * string (Radix Select requires string values); callers parse to number.
 */
export function ModelSelect({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: models, isLoading } = trpc.aiModel.list.useQuery({ limit: 200 });

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? t("aiEval.selectModel", "Chọn model...")} />
      </SelectTrigger>
      <SelectContent>
        {(models ?? []).map((m: any) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name} <span className="text-muted-foreground">({m.code})</span>
          </SelectItem>
        ))}
        {(!models || models.length === 0) && (
          <SelectItem value="__none__" disabled>
            {t("aiEval.noModels", "Chưa có model")}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * Shared dataset id input — WS-1.
 *
 * NOTE: there is currently NO mounted tRPC endpoint that lists training
 * datasets (the trainingRouter holding `listDatasets` is defined but commented
 * out of `aiAdvancedRouter`). So this is a numeric id entry (a dataset must be
 * created first via the Advanced AI flow). `modelId` is accepted for API
 * compatibility / future wiring but is not used yet.
 */
export function DatasetSelect({
  value,
  onChange,
  modelId: _modelId,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  modelId?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Input
      type="number"
      min={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      placeholder={placeholder ?? t("aiEval.datasetIdPlaceholder", "Dataset ID...")}
    />
  );
}
