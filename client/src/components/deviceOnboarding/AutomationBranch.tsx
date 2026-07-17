// Doc 56 Đ2b nhóm 1 — nhánh AUTOMATION (bắt vít / điểm keo / hàn / leak-test…).
// 6 bước: (1) thông tin máy → (2) giao thức (HTTP push | PLC adapter | MQTT) →
// (3) recipe khởi tạo → (4) guardrail BẮT BUỘC → (5) credential → (6) sign-off.
//
// WIZARD THIẾT KẾ: thu thập cấu hình vào state cục bộ; provisioning thật (tạo máy,
// seed recipe + parameter_guardrails, cấp mk_) ở Đợt 4. KHÔNG gọi procedure tạo máy.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  BadgeCheck,
  CheckCircle2,
  Info,
  PenLine,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMachineTypes } from "@/hooks/useMachineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";
import { WizardShell, StepNav } from "./WizardShell";
import { CredentialGuide } from "./CredentialGuide";
import {
  ADAPTER_SDK_PATH,
  AUTOMATION_PROTOCOLS,
  DOC57_PATH,
  hasValidGuardrail,
  initialAutomationDraft,
  newRowId,
  type AutomationDraft,
  type AutomationProtocol,
  type GuardrailRow,
} from "./types";

const STEP_COUNT = 6;

export function AutomationBranch({
  onChangeClass,
}: {
  onChangeClass: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AutomationDraft>(initialAutomationDraft);

  const { byClass } = useMachineTypes();
  const automationTypes = byClass.automation;

  const update = (patch: Partial<AutomationDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const onNext = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const onBack = () => setStep((s) => Math.max(s - 1, 0));

  const steps = [
    t("deviceOnboarding.automation.steps.info"),
    t("deviceOnboarding.automation.steps.protocol"),
    t("deviceOnboarding.automation.steps.recipe"),
    t("deviceOnboarding.automation.steps.guardrail"),
    t("deviceOnboarding.automation.steps.credential"),
    t("deviceOnboarding.automation.steps.signoff"),
  ];

  const machineLabel = draft.code ? `${draft.code} — ${draft.name || draft.code}` : "—";

  // ── Guardrail row helpers ──────────────────────────────────────────────────
  const addGuardrail = () =>
    update({
      guardrails: [
        ...draft.guardrails,
        { id: newRowId("gr"), param: "", min: "", max: "", maxStep: "", unit: "" },
      ],
    });
  const updateGuardrail = (id: string, patch: Partial<GuardrailRow>) =>
    update({ guardrails: draft.guardrails.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeGuardrail = (id: string) =>
    update({ guardrails: draft.guardrails.filter((r) => r.id !== id) });

  // ── Per-step gate ──────────────────────────────────────────────────────────
  const canNext = (() => {
    switch (step) {
      case 0:
        return draft.machineType !== "" && draft.code.trim().length > 0;
      case 1:
        return true; // luôn có protocol mặc định
      case 2:
        return draft.recipeCode.trim().length > 0;
      case 3:
        return hasValidGuardrail(draft.guardrails);
      case 4:
        return draft.credentialAcknowledged;
      default:
        return true;
    }
  })();

  return (
    <WizardShell
      title={t("deviceOnboarding.automation.title")}
      subtitle={t("deviceOnboarding.automation.subtitle")}
      icon={Wrench}
      steps={steps}
      step={step}
      stepDescription={t(`deviceOnboarding.automation.stepDesc.${step}`)}
      onChangeClass={onChangeClass}
      changeClassLabel={t("deviceOnboarding.changeClass")}
    >
      {/* ── Bước 1 — thông tin máy ── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("deviceOnboarding.automation.machineType")} *</Label>
              <Select
                value={draft.machineType || undefined}
                onValueChange={(v) => update({ machineType: v })}
              >
                <SelectTrigger data-testid="device-onboard-auto-type">
                  <SelectValue placeholder={t("deviceOnboarding.automation.machineTypePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {automationTypes.map((e) => (
                    <SelectItem key={e.type} value={e.type}>
                      {machineTypeLabel(t, e.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-code">{t("deviceOnboarding.automation.code")} *</Label>
              <Input
                id="auto-code"
                data-testid="device-onboard-auto-code"
                placeholder="SCRW-01"
                value={draft.code}
                onChange={(e) => update({ code: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-name">{t("deviceOnboarding.automation.name")}</Label>
              <Input
                id="auto-name"
                placeholder={t("deviceOnboarding.automation.namePlaceholder")}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-station">{t("deviceOnboarding.automation.station")}</Label>
              <Input
                id="auto-station"
                placeholder="ST-SCRW-A"
                value={draft.stationId}
                onChange={(e) => update({ stationId: e.target.value })}
              />
            </div>
          </div>
          <StepNav
            hideBack
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-auto-step0-next"
          />
        </div>
      )}

      {/* ── Bước 2 — giao thức ── */}
      {step === 1 && (
        <div className="space-y-4">
          <RadioGroup
            value={draft.protocol}
            onValueChange={(v) => update({ protocol: v as AutomationProtocol })}
            className="grid gap-3"
          >
            {AUTOMATION_PROTOCOLS.map((p) => (
              <Label
                key={p.value}
                htmlFor={`auto-proto-${p.value}`}
                className={
                  "rounded-lg border p-4 cursor-pointer space-y-1 " +
                  (draft.protocol === p.value ? "border-primary ring-1 ring-primary" : "")
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  <RadioGroupItem value={p.value} id={`auto-proto-${p.value}`} />
                  {t(`deviceOnboarding.automation.protocol.${p.key}Title`)}
                </span>
                <span className="block text-xs text-muted-foreground font-normal">
                  {t(`deviceOnboarding.automation.protocol.${p.key}Desc`)}
                </span>
                <code className="block text-[11px] bg-muted rounded px-2 py-1 mt-1 overflow-x-auto whitespace-nowrap">
                  {p.target}
                </code>
              </Label>
            ))}
          </RadioGroup>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs space-y-1">
              <p>{t("deviceOnboarding.automation.protocol.specHint")}</p>
              <p className="font-mono text-[11px]">{DOC57_PATH}</p>
              <p className="font-mono text-[11px]">{ADAPTER_SDK_PATH}</p>
            </AlertDescription>
          </Alert>
          <StepNav
            onBack={onBack}
            onNext={onNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
          />
        </div>
      )}

      {/* ── Bước 3 — recipe khởi tạo (placeholder) ── */}
      {step === 2 && (
        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t("deviceOnboarding.automation.recipe.hint")}
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="auto-recipe-code">{t("deviceOnboarding.automation.recipe.code")} *</Label>
              <Input
                id="auto-recipe-code"
                data-testid="device-onboard-auto-recipe"
                placeholder="TQ-M3-08"
                value={draft.recipeCode}
                onChange={(e) => update({ recipeCode: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-recipe-version">{t("deviceOnboarding.automation.recipe.version")}</Label>
              <Input
                id="auto-recipe-version"
                placeholder="2.1"
                value={draft.recipeVersion}
                onChange={(e) => update({ recipeVersion: e.target.value })}
              />
            </div>
          </div>
          <StepNav
            onBack={onBack}
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
          />
        </div>
      )}

      {/* ── Bước 4 — guardrail (BẮT BUỘC) ── */}
      {step === 3 && (
        <div className="space-y-4">
          <Alert variant={hasValidGuardrail(draft.guardrails) ? "default" : "destructive"}>
            <SlidersHorizontal className="h-4 w-4" />
            <AlertTitle>{t("deviceOnboarding.automation.guardrail.title")}</AlertTitle>
            <AlertDescription className="text-xs">
              {t("deviceOnboarding.automation.guardrail.desc")}
            </AlertDescription>
          </Alert>

          {draft.guardrails.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("deviceOnboarding.automation.guardrail.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {/* header labels */}
              <div className="hidden sm:grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_auto] gap-2 text-[11px] text-muted-foreground px-1">
                <span>{t("deviceOnboarding.automation.guardrail.param")}</span>
                <span>{t("deviceOnboarding.automation.guardrail.min")}</span>
                <span>{t("deviceOnboarding.automation.guardrail.max")}</span>
                <span>{t("deviceOnboarding.automation.guardrail.maxStep")}</span>
                <span>{t("deviceOnboarding.automation.guardrail.unit")}</span>
                <span />
              </div>
              {draft.guardrails.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_auto] gap-2"
                >
                  <Input
                    className="h-8 text-xs"
                    placeholder="torqueTarget"
                    value={r.param}
                    onChange={(e) => updateGuardrail(r.id, { param: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    placeholder="min"
                    value={r.min}
                    onChange={(e) => updateGuardrail(r.id, { min: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    placeholder="max"
                    value={r.max}
                    onChange={(e) => updateGuardrail(r.id, { max: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    placeholder="maxStep"
                    value={r.maxStep}
                    onChange={(e) => updateGuardrail(r.id, { maxStep: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Nm"
                    value={r.unit}
                    onChange={(e) => updateGuardrail(r.id, { unit: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive hover:text-destructive"
                    onClick={() => removeGuardrail(r.id)}
                    aria-label={t("deviceOnboarding.automation.guardrail.remove")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={addGuardrail}
            data-testid="device-onboard-add-guardrail"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("deviceOnboarding.automation.guardrail.add")}
          </Button>

          <StepNav
            onBack={onBack}
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-auto-step3-next"
          />
        </div>
      )}

      {/* ── Bước 5 — credential ── */}
      {step === 4 && (
        <div className="space-y-4">
          <CredentialGuide
            machineLabel={machineLabel}
            suggestedSerialPattern={draft.code}
            acknowledged={draft.credentialAcknowledged}
            onAcknowledgedChange={(v) => update({ credentialAcknowledged: v })}
          />
          <StepNav
            onBack={onBack}
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-auto-step4-next"
          />
        </div>
      )}

      {/* ── Bước 6 — sign-off ── */}
      {step === 5 && (
        <SignOff
          rows={[
            [t("deviceOnboarding.automation.machineType"), draft.machineType ? machineTypeLabel(t, draft.machineType) : "—"],
            [t("deviceOnboarding.automation.code"), machineLabel],
            [t("deviceOnboarding.automation.station"), draft.stationId || "—"],
            [
              t("deviceOnboarding.automation.steps.protocol"),
              t(`deviceOnboarding.automation.protocol.${AUTOMATION_PROTOCOLS.find((p) => p.value === draft.protocol)?.key ?? "http"}Title`),
            ],
            [
              t("deviceOnboarding.automation.steps.recipe"),
              draft.recipeCode ? `${draft.recipeCode}${draft.recipeVersion ? ` v${draft.recipeVersion}` : ""}` : "—",
            ],
            [
              t("deviceOnboarding.automation.steps.guardrail"),
              t("deviceOnboarding.automation.guardrail.count", { n: draft.guardrails.filter((r) => r.param.trim()).length }),
            ],
          ]}
          signedOff={draft.signedOff}
          onSign={() => update({ signedOff: true })}
          onBack={onBack}
          onFinish={() => navigate("/datasettings?tab=enrollment-tokens")}
        />
      )}
    </WizardShell>
  );
}

/** Bảng tóm tắt + ký duyệt (thiết kế) — dùng chung cho cả hai nhánh non-aoi. */
export function SignOff({
  rows,
  signedOff,
  onSign,
  onBack,
  onFinish,
}: {
  rows: Array<[string, string]>;
  signedOff: boolean;
  onSign: () => void;
  onBack: () => void;
  onFinish: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-2" data-testid="device-onboard-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground shrink-0">{k}</span>
            <span className="text-right break-all">{v}</span>
          </div>
        ))}
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          {t("deviceOnboarding.signoff.deferNote")}
        </AlertDescription>
      </Alert>

      {!signedOff ? (
        <StepNav
          onBack={onBack}
          onNext={onSign}
          backLabel={t("deviceOnboarding.back")}
          nextLabel={t("deviceOnboarding.signoff.sign")}
          nextTestId="device-onboard-sign"
        />
      ) : (
        <div className="space-y-3" data-testid="device-onboard-signed">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-success" />
              {t("deviceOnboarding.signoff.doneTitle")}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {t("deviceOnboarding.signoff.doneDesc")}
            </AlertDescription>
          </Alert>
          <div className="flex justify-end gap-2">
            <Badge variant="secondary" className="self-center">
              <PenLine className="h-3 w-3 mr-1" />
              {t("deviceOnboarding.signoff.designBadge")}
            </Badge>
            <Button onClick={onFinish}>{t("deviceOnboarding.signoff.finish")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
