/**
 * AIGuidedActionCards — UX group B (P0)
 *
 * Guided, form-driven entry points for the 4 engineering agentic-WRITE tools
 * (server/services/aiLocalTools/writeHandlers/engineering.ts):
 *   - adjust_ng_threshold            (điều chỉnh ngưỡng NG warning/critical)
 *   - configure_inspection_param     (số mẫu tối thiểu / cooldown)
 *   - create_ng_threshold            (tạo ngưỡng NG mới cho 1 trạm)
 *   - update_product_quality_target  (cập nhật target/min FPY của 1 mẫu SP)
 *
 * ── HITL INVARIANT ─────────────────────────────────────────────────────────
 * These cards NEVER call a write endpoint. A card only opens a small form that
 * collects valid inputs (with the REAL min/max bounds from the tool schemas),
 * then COMPOSES a clear natural-language (vi) request and SENDS it through the
 * existing AI chat flow (the `onSend` callback). The request routes to the
 * write-tool which proposes the change, and the user still confirms via the
 * existing HITL confirm card inside the chat. No bypass.
 *
 * ── Role gating ────────────────────────────────────────────────────────────
 * Write-action cards are only shown to roles that can use the engineering
 * tools: maintenance / supervisor / admin (mirrors the tools' RBAC modules
 * settings_alerts / settings_products). Other roles see nothing.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmActionCard, type ActionState, type PendingAction } from "@/components/ConfirmActionCard";
import { Sparkles, SlidersHorizontal, Gauge, PlusCircle, Target, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// Roles allowed to use the engineering write-tools (app roles, lowercased).
const WRITE_ROLES = new Set(["maintenance", "supervisor", "admin"]);

type ActionId =
  | "adjust_ng_threshold"
  | "configure_inspection_param"
  | "create_ng_threshold"
  | "update_product_quality_target";

interface FieldNumber {
  type: "number";
  name: string;
  labelKey: string;
  labelFallback: string;
  min: number;
  max: number;
  required?: boolean;
  integer?: boolean;
  placeholder?: string;
}
interface FieldText {
  type: "text";
  name: string;
  labelKey: string;
  labelFallback: string;
  maxLength: number;
  required?: boolean;
}
interface FieldPicker {
  type: "ngThreshold" | "station" | "productModel";
  name: string;
  labelKey: string;
  labelFallback: string;
  required?: boolean;
}
type Field = FieldNumber | FieldText | FieldPicker;

interface ActionDef {
  id: ActionId;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  fields: Field[];
  /** Build the natural-language (vi) request that routes to the write-tool. */
  /** ⚠ Nhận `t` vì mảng ACTIONS ở CẤP MODULE — gọi `t()` ở đó sẽ đóng băng ngôn ngữ lúc import. */
  buildRequest: (v: Record<string, string>, t: TFn) => string;
}

// ── Field bounds mirror the zod schemas in engineering.ts (defense in depth) ──
const ACTIONS: ActionDef[] = [
  {
    id: "adjust_ng_threshold",
    icon: SlidersHorizontal,
    titleKey: "aiGuided.adjustNg.title",
    titleFallback: "Điều chỉnh ngưỡng NG",
    descKey: "aiGuided.adjustNg.desc",
    descFallback: "Thay đổi ngưỡng cảnh báo / nghiêm trọng (%) của một ngưỡng NG có sẵn.",
    fields: [
      { type: "ngThreshold", name: "thresholdId", labelKey: "aiGuided.field.ngThreshold", labelFallback: "Ngưỡng NG", required: true },
      { type: "number", name: "warningThreshold", labelKey: "aiGuided.field.warning", labelFallback: "Ngưỡng cảnh báo (%)", min: 0, max: 100 },
      { type: "number", name: "criticalThreshold", labelKey: "aiGuided.field.critical", labelFallback: "Ngưỡng nghiêm trọng (%)", min: 0, max: 100 },
    ],
    buildRequest: (v, t) => {
      const parts: string[] = [];
      if (v.warningThreshold) parts.push(t("aiGuided.part.warning", { value: v.warningThreshold }));
      if (v.criticalThreshold) parts.push(t("aiGuided.part.critical", { value: v.criticalThreshold }));
      return t("aiGuided.req.adjustNg", { id: v.thresholdId, parts: parts.join(", ") });
    },
  },
  {
    id: "configure_inspection_param",
    icon: Gauge,
    titleKey: "aiGuided.configInspect.title",
    titleFallback: "Cấu hình tham số kiểm tra",
    descKey: "aiGuided.configInspect.desc",
    descFallback: "Đặt số mẫu tối thiểu / cooldown cho một ngưỡng NG có sẵn.",
    fields: [
      { type: "ngThreshold", name: "thresholdId", labelKey: "aiGuided.field.ngThreshold", labelFallback: "Ngưỡng NG", required: true },
      { type: "number", name: "minSampleSize", labelKey: "aiGuided.field.minSample", labelFallback: "Số mẫu tối thiểu", min: 1, max: 100000, integer: true },
      { type: "number", name: "cooldownMinutes", labelKey: "aiGuided.field.cooldown", labelFallback: "Cooldown (phút)", min: 1, max: 1440, integer: true },
    ],
    buildRequest: (v, t) => {
      const parts: string[] = [];
      if (v.minSampleSize) parts.push(t("aiGuided.part.minSample", { value: v.minSampleSize }));
      if (v.cooldownMinutes) parts.push(t("aiGuided.part.cooldown", { value: v.cooldownMinutes }));
      return t("aiGuided.req.configInspect", { id: v.thresholdId, parts: parts.join(", ") });
    },
  },
  {
    id: "create_ng_threshold",
    icon: PlusCircle,
    titleKey: "aiGuided.createNg.title",
    titleFallback: "Tạo ngưỡng NG mới",
    descKey: "aiGuided.createNg.desc",
    descFallback: "Thêm một bản ghi cấu hình ngưỡng NG mới cho một trạm.",
    fields: [
      { type: "station", name: "stationId", labelKey: "aiGuided.field.station", labelFallback: "Trạm", required: true },
      { type: "text", name: "name", labelKey: "aiGuided.field.name", labelFallback: "Tên ngưỡng", maxLength: 255, required: true },
      { type: "number", name: "warningThreshold", labelKey: "aiGuided.field.warning", labelFallback: "Ngưỡng cảnh báo (%)", min: 0, max: 100, required: true },
      { type: "number", name: "criticalThreshold", labelKey: "aiGuided.field.critical", labelFallback: "Ngưỡng nghiêm trọng (%)", min: 0, max: 100, required: true },
      { type: "number", name: "minSampleSize", labelKey: "aiGuided.field.minSample", labelFallback: "Số mẫu tối thiểu", min: 1, max: 100000, integer: true },
      { type: "number", name: "cooldownMinutes", labelKey: "aiGuided.field.cooldown", labelFallback: "Cooldown (phút)", min: 1, max: 1440, integer: true },
    ],
    buildRequest: (v, t) => {
      const extra: string[] = [];
      if (v.minSampleSize) extra.push(t("aiGuided.part.minSample", { value: v.minSampleSize }));
      if (v.cooldownMinutes) extra.push(t("aiGuided.part.cooldown", { value: v.cooldownMinutes }));
      const tail = extra.length ? `, ${extra.join(", ")}` : "";
      return t("aiGuided.req.createNg", { name: v.name, stationId: v.stationId, warning: v.warningThreshold, critical: v.criticalThreshold, tail });
    },
  },
  {
    id: "update_product_quality_target",
    icon: Target,
    titleKey: "aiGuided.updateTarget.title",
    titleFallback: "Cập nhật mục tiêu chất lượng",
    descKey: "aiGuided.updateTarget.desc",
    descFallback: "Đặt mục tiêu / tối thiểu FPY (%) cho một mẫu sản phẩm.",
    fields: [
      { type: "productModel", name: "productModelId", labelKey: "aiGuided.field.productModel", labelFallback: "Mẫu sản phẩm", required: true },
      { type: "number", name: "targetYieldRate", labelKey: "aiGuided.field.targetFpy", labelFallback: "Mục tiêu FPY (%)", min: 0, max: 100 },
      { type: "number", name: "minYieldRate", labelKey: "aiGuided.field.minFpy", labelFallback: "FPY tối thiểu (%)", min: 0, max: 100 },
    ],
    buildRequest: (v, t) => {
      const parts: string[] = [];
      if (v.targetYieldRate) parts.push(t("aiGuided.part.targetFpy", { value: v.targetYieldRate }));
      if (v.minYieldRate) parts.push(t("aiGuided.part.minFpy", { value: v.minYieldRate }));
      return t("aiGuided.req.updateTarget", { id: v.productModelId, parts: parts.join(", ") });
    },
  },
];

// ── At-least-one-of validation (mirrors the zod .refine in the schemas) ──
const REQUIRE_ONE_OF: Partial<Record<ActionId, string[]>> = {
  adjust_ng_threshold: ["warningThreshold", "criticalThreshold"],
  configure_inspection_param: ["minSampleSize", "cooldownMinutes"],
  update_product_quality_target: ["targetYieldRate", "minYieldRate"],
};

// ── doc69 Wave2 A3 — pre-computed suggested actions (server/services/ai/
// rcaActionSuggester.ts) surfaced on an RCA insight / report response ─────────
type TFn = ReturnType<typeof useTranslation>["t"];

export interface RcaSuggestedActionCard {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  requiredPermission: { module: string; action: string };
}

export interface AIGuidedActionCardsProps {
  /** Sends the composed NL request through the chat (→ HITL propose/confirm). */
  onSend: (request: string) => void;
  disabled?: boolean;
  className?: string;
  /**
   * doc69 Wave2 A3 — ready-made, ALREADY-VALIDATED suggested actions (tool + args +
   * requiredPermission) mapped from an RCA/report recommendation. Rendered as extra
   * 1-tap cards that propose DIRECTLY via aiCopilot.proposeSuggestedAction →
   * aiCopilot.confirmAction — the SAME HITL write path every other write-tool uses
   * (no NL round-trip through chat, no fabricated args). Individually RBAC-gated by
   * `requiredPermission`, independent of the WRITE_ROLES gate below — a card only
   * renders for a user who actually holds that tool's permission.
   */
  suggestedActions?: RcaSuggestedActionCard[];
  /**
   * Hide the 4 generic guided-form cards below (used when this component is
   * embedded purely to render `suggestedActions` outside the AI chat page, e.g.
   * on the Root Cause Analysis / AI Reports pages).
   */
  hideStaticActions?: boolean;
}

export default function AIGuidedActionCards({
  onSend,
  disabled,
  className,
  suggestedActions,
  hideStaticActions,
}: AIGuidedActionCardsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission, isAdmin } = usePermissions();

  const canWrite = useMemo(() => {
    const role = (user?.role ?? "").toString().toLowerCase().trim();
    return WRITE_ROLES.has(role);
  }, [user?.role]);

  const [active, setActive] = useState<ActionDef | null>(null);

  // RBAC gate #1 (advisory-only for a non-permitted viewer — no button renders).
  const permittedSuggested = useMemo(
    () =>
      (suggestedActions ?? []).filter(
        (a) => isAdmin === true || hasPermission(a.requiredPermission.module, a.requiredPermission.action as any),
      ),
    [suggestedActions, isAdmin, hasPermission],
  );

  const showStatic = !hideStaticActions && canWrite;

  // Nothing to show at all → render nothing (unchanged from before this prop existed).
  if (!showStatic && permittedSuggested.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {permittedSuggested.length > 0 && (
        <SuggestedActionCards actions={permittedSuggested} disabled={disabled} />
      )}

      {showStatic && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("aiGuided.sectionTitle", "Tác vụ kỹ thuật có hướng dẫn")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActive(a)}
                  className="text-left rounded-lg border bg-card hover:bg-muted/60 transition-colors p-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{t(a.titleKey, a.titleFallback)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {t(a.descKey, a.descFallback)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {active && (
        <GuidedActionDialog
          action={active}
          onClose={() => setActive(null)}
          onSubmit={(request) => {
            setActive(null);
            onSend(request);
          }}
        />
      )}
    </div>
  );
}

// ─── doc69 Wave2 A3 — 1-tap suggested-action cards (propose → confirm, no form) ───

function SuggestedActionCards({
  actions,
  disabled,
}: {
  actions: RcaSuggestedActionCard[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {t("aiGuided.suggestedTitle", "Đề xuất hành động (1 chạm)")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {actions.map((a, i) => (
          <button
            key={`${a.tool}-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => setOpenIndex(i)}
            className="text-left rounded-lg border bg-card hover:bg-muted/60 transition-colors p-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-start gap-2.5">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-medium leading-snug line-clamp-3">{a.summary}</p>
            </div>
          </button>
        ))}
      </div>

      {openIndex != null && (
        <SuggestedActionDialog action={actions[openIndex]} onClose={() => setOpenIndex(null)} />
      )}
    </div>
  );
}

function SuggestedActionDialog({
  action,
  onClose,
}: {
  action: RcaSuggestedActionCard;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("vi") ? "vi" : i18n.language?.startsWith("zh") ? "zh" : "en") as
    | "vi"
    | "en"
    | "zh";

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [state, setState] = useState<ActionState | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  const proposeM = trpc.aiCopilot.proposeSuggestedAction.useMutation();
  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const cancelM = trpc.aiCopilot.cancelAction.useMutation();

  // Propose IMMEDIATELY on open — this is the dry-run preview (NO mutation yet);
  // the user still explicitly confirms below (HITL invariant preserved).
  useEffect(() => {
    let cancelled = false;
    proposeM
      .mutateAsync({ tool: action.tool as any, args: action.args, lang })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.pendingAction) {
          setPending(res.pendingAction as unknown as PendingAction);
          setState("pending");
        } else {
          setMessage((res as any).message ?? t("aiGuided.proposeFailed", "Không thể đề xuất thao tác này."));
        }
      })
      .catch(() => {
        if (!cancelled) setMessage(t("aiGuided.proposeFailed", "Không thể đề xuất thao tác này."));
      });
    return () => {
      cancelled = true;
    };
    // Propose exactly once per dialog open — action identity is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.tool]);

  const busy = proposeM.isPending || confirmM.isPending || cancelM.isPending;

  const onConfirm = async () => {
    if (!pending) return;
    const res = await confirmM.mutateAsync({ actionId: pending.actionId, token: pending.token, lang });
    setState((res.status as ActionState) ?? (res.ok ? "executed" : undefined));
    setMessage(res.message ?? null);
  };

  const onCancel = async () => {
    if (pending && state === "pending") {
      await cancelM.mutateAsync({ actionId: pending.actionId }).catch(() => undefined);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("aiGuided.suggestedTitle", "Đề xuất hành động (1 chạm)")}</DialogTitle>
          <DialogDescription>{action.summary}</DialogDescription>
        </DialogHeader>

        {!pending && !message && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            {t("aiGuided.loading", "Đang tải...")}
          </div>
        )}

        {message && !pending && (
          <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
        )}

        {pending && (
          <ConfirmActionCard
            action={pending}
            state={state}
            message={message}
            busy={busy}
            onConfirm={onConfirm}
            onCancel={onCancel}
            t={t}
          />
        )}

        {state && state !== "pending" && (
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close", "Đóng")}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal form for a single guided action ────────────────────────────────────

function GuidedActionDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: ActionDef;
  onClose: () => void;
  onSubmit: (request: string) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, val: string) => {
    setValues((prev) => ({ ...prev, [name]: val }));
    setError(null);
  };

  const validate = (): string | null => {
    for (const f of action.fields) {
      const raw = (values[f.name] ?? "").trim();
      if (f.required && !raw) {
        return t("aiGuided.errRequired", "Vui lòng nhập đầy đủ các trường bắt buộc.");
      }
      if (f.type === "number" && raw) {
        const n = Number(raw);
        if (Number.isNaN(n)) return t("aiGuided.errNumber", "Giá trị phải là số.");
        if (f.integer && !Number.isInteger(n)) return t("aiGuided.errInteger", "Giá trị phải là số nguyên.");
        if (n < f.min || n > f.max) {
          return t("aiGuided.errRange", "Giá trị {{field}} phải trong khoảng {{min}}–{{max}}.", {
            field: t(f.labelKey, f.labelFallback),
            min: f.min,
            max: f.max,
          });
        }
      }
    }
    // At-least-one-of optional groups.
    const group = REQUIRE_ONE_OF[action.id];
    if (group && !group.some((name) => (values[name] ?? "").trim())) {
      return t("aiGuided.errAtLeastOne", "Cần nhập ít nhất một giá trị để thay đổi.");
    }
    // Cross-field sanity (mirrors tool warnings) — friendly, not blocking-only.
    const warn = Number(values.warningThreshold);
    const crit = Number(values.criticalThreshold);
    if (values.warningThreshold && values.criticalThreshold && crit < warn) {
      return t("aiGuided.errCritLtWarn", "Ngưỡng nghiêm trọng phải ≥ ngưỡng cảnh báo.");
    }
    const target = Number(values.targetYieldRate);
    const min = Number(values.minYieldRate);
    if (values.targetYieldRate && values.minYieldRate && min > target) {
      return t("aiGuided.errMinGtTarget", "FPY tối thiểu phải ≤ mục tiêu FPY.");
    }
    return null;
  };

  const handleSubmit = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    onSubmit(action.buildRequest(values, t));
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(action.titleKey, action.titleFallback)}</DialogTitle>
          <DialogDescription>{t(action.descKey, action.descFallback)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {action.fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label className="text-xs">
                {t(f.labelKey, f.labelFallback)}
                {f.required && <span className="text-red-500 ml-0.5">*</span>}
                {f.type === "number" && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    ({f.min}–{f.max})
                  </span>
                )}
              </Label>
              <GuidedField field={f} value={values[f.name] ?? ""} onChange={(val) => set(f.name, val)} />
            </div>
          ))}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <p className="text-[11px] text-muted-foreground leading-snug">
            {t(
              "aiGuided.hitlNote",
              "Lưu ý: thao tác sẽ được gửi tới trợ lý AI và bạn vẫn cần XÁC NHẬN ở thẻ xác nhận trước khi áp dụng.",
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("aiGuided.cancel", "Hủy")}
          </Button>
          <Button onClick={handleSubmit}>
            <Send className="h-4 w-4 mr-1.5" />
            {t("aiGuided.send", "Gửi tới trợ lý")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Individual field renderers (pickers use existing tRPC list queries) ──────

function GuidedField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation();

  if (field.type === "number") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : "any"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? `${field.min}–${field.max}`}
      />
    );
  }
  if (field.type === "text") {
    return (
      <Input
        type="text"
        maxLength={field.maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "ngThreshold") return <NgThresholdPicker value={value} onChange={onChange} />;
  if (field.type === "station") return <StationPicker value={value} onChange={onChange} />;
  if (field.type === "productModel") return <ProductModelPicker value={value} onChange={onChange} />;

  // Exhaustive — never reached.
  void t;
  return null;
}

function NgThresholdPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  // ngRateThreshold.list — existing NG thresholds (joined with station name).
  const { data, isLoading } = trpc.ngRateThreshold.list.useQuery(undefined, { staleTime: 60_000 });
  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading
              ? t("aiGuided.loading", "Đang tải...")
              : t("aiGuided.field.ngThresholdPlaceholder", "Chọn ngưỡng NG")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {items.length === 0 && !isLoading ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("aiGuided.noData", "Không có dữ liệu")}
          </div>
        ) : (
          items.map((it: any) => (
            <SelectItem key={it.id} value={String(it.id)}>
              #{it.id} — {it.name ?? t("aiGuided.unnamed", "Không tên")}
              {it.stationName ? ` (${it.stationName})` : ""}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function StationPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.station.list.useQuery(undefined, { staleTime: 60_000 });
  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading ? t("aiGuided.loading", "Đang tải...") : t("aiGuided.field.stationPlaceholder", "Chọn trạm")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {items.length === 0 && !isLoading ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t("aiGuided.noData", "Không có dữ liệu")}</div>
        ) : (
          items.map((s: any) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.code ? `${s.code} — ${s.name}` : s.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function ProductModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = trpc.productModel.list.useQuery(
    { limit: 100, sortBy: "code", sortOrder: "asc" },
    { staleTime: 60_000 },
  );
  const items: any[] = Array.isArray(data) ? data : ((data as any)?.items ?? []);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading
              ? t("aiGuided.loading", "Đang tải...")
              : t("aiGuided.field.productModelPlaceholder", "Chọn mẫu sản phẩm")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {items.length === 0 && !isLoading ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t("aiGuided.noData", "Không có dữ liệu")}</div>
        ) : (
          items.map((p: any) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.code ? `${p.code} — ${p.name}` : p.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
