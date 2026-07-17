// Doc 56 Đ2b nhóm 1 — nhánh IOT (ESP32 nhiệt-ẩm / cảm biến LAN xưởng).
// 5 bước: (1) thông tin (loại + code + workshop cho station ảo) → (2) kênh
// (HTTP telemetry | MQTT) → (3) lược đồ metric → (4) credential (mk_ + cert QĐ4) →
// (5) sign-off.
//
// WIZARD THIẾT KẾ (state cục bộ); provisioning thật (station ảo IOT-<ws>, cấp mk_,
// MQTT ACL) ở Đợt 4 (mig 0292 IoT identity). KHÔNG gọi procedure tạo thiết bị ở đây.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Cpu, Gauge, Info, Plus, RadioTower, Trash2 } from "lucide-react";
import { machineTypeLabel } from "@/lib/machineTypeLabel";
import { WizardShell, StepNav } from "./WizardShell";
import { CredentialGuide } from "./CredentialGuide";
import { SignOff } from "./AutomationBranch";
import {
  IOT_CHANNELS,
  IOT_MACHINE_TYPES,
  IOT_METRIC_PRESETS,
  hasValidMetric,
  initialIotDraft,
  newRowId,
  type IotChannel,
  type IotDraft,
  type IotMachineType,
  type MetricRow,
} from "./types";

type WorkshopRow = { id: number; factoryId: number; code: string; name: string };

const STEP_COUNT = 5;

export function IotBranch({
  onChangeClass,
}: {
  onChangeClass: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<IotDraft>(initialIotDraft);

  const workshopsQuery = trpc.workshop.list.useQuery();
  const workshops = (workshopsQuery.data ?? []) as WorkshopRow[];
  const selectedWorkshop = workshops.find((w) => String(w.id) === draft.workshopId);
  const virtualStation = selectedWorkshop ? `IOT-${selectedWorkshop.code}` : null;

  const update = (patch: Partial<IotDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const onNext = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const onBack = () => setStep((s) => Math.max(s - 1, 0));

  const steps = [
    t("deviceOnboarding.iot.steps.info"),
    t("deviceOnboarding.iot.steps.channel"),
    t("deviceOnboarding.iot.steps.metrics"),
    t("deviceOnboarding.iot.steps.credential"),
    t("deviceOnboarding.iot.steps.signoff"),
  ];

  const machineLabel = draft.code ? `${draft.code} — ${machineTypeLabel(t, draft.machineType)}` : "—";

  // ── Metric row helpers ─────────────────────────────────────────────────────
  const addMetric = (preset?: { name: string; unit: string }) =>
    update({
      metrics: [
        ...draft.metrics,
        { id: newRowId("mt"), name: preset?.name ?? "", unit: preset?.unit ?? "" },
      ],
    });
  const updateMetric = (id: string, patch: Partial<MetricRow>) =>
    update({ metrics: draft.metrics.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeMetric = (id: string) =>
    update({ metrics: draft.metrics.filter((r) => r.id !== id) });

  const canNext = (() => {
    switch (step) {
      case 0:
        return draft.code.trim().length > 0 && draft.workshopId !== "";
      case 1:
        return true;
      case 2:
        return hasValidMetric(draft.metrics);
      case 3:
        return draft.credentialAcknowledged;
      default:
        return true;
    }
  })();

  return (
    <WizardShell
      title={t("deviceOnboarding.iot.title")}
      subtitle={t("deviceOnboarding.iot.subtitle")}
      icon={Cpu}
      steps={steps}
      step={step}
      stepDescription={t(`deviceOnboarding.iot.stepDesc.${step}`)}
      onChangeClass={onChangeClass}
      changeClassLabel={t("deviceOnboarding.changeClass")}
    >
      {/* ── Bước 1 — thông tin ── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("deviceOnboarding.iot.deviceType")} *</Label>
              <Select
                value={draft.machineType}
                onValueChange={(v) => update({ machineType: v as IotMachineType })}
              >
                <SelectTrigger data-testid="device-onboard-iot-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IOT_MACHINE_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>
                      {machineTypeLabel(t, tp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iot-code">{t("deviceOnboarding.iot.code")} *</Label>
              <Input
                id="iot-code"
                data-testid="device-onboard-iot-code"
                placeholder="esp32-ws3-01"
                value={draft.code}
                onChange={(e) => update({ code: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("deviceOnboarding.iot.workshop")} *</Label>
              <Select
                value={draft.workshopId || undefined}
                onValueChange={(v) => update({ workshopId: v })}
              >
                <SelectTrigger data-testid="device-onboard-iot-workshop">
                  <SelectValue placeholder={t("deviceOnboarding.iot.workshopPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {workshops.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {virtualStation && (
                <p className="text-xs text-muted-foreground">
                  {t("deviceOnboarding.iot.virtualStation")}{" "}
                  <code className="bg-muted rounded px-1 py-0.5">{virtualStation}</code>
                </p>
              )}
            </div>
          </div>
          <StepNav
            hideBack
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-iot-step0-next"
          />
        </div>
      )}

      {/* ── Bước 2 — kênh ── */}
      {step === 1 && (
        <div className="space-y-4">
          <RadioGroup
            value={draft.channel}
            onValueChange={(v) => update({ channel: v as IotChannel })}
            className="grid gap-3 sm:grid-cols-2"
          >
            {IOT_CHANNELS.map((c) => (
              <Label
                key={c.value}
                htmlFor={`iot-chan-${c.value}`}
                className={
                  "rounded-lg border p-4 cursor-pointer space-y-1 " +
                  (draft.channel === c.value ? "border-primary ring-1 ring-primary" : "")
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  <RadioGroupItem value={c.value} id={`iot-chan-${c.value}`} />
                  <RadioTower className="h-4 w-4" />
                  {t(`deviceOnboarding.iot.channel.${c.key}Title`)}
                </span>
                <span className="block text-xs text-muted-foreground font-normal">
                  {t(`deviceOnboarding.iot.channel.${c.key}Desc`)}
                </span>
                <code className="block text-[11px] bg-muted rounded px-2 py-1 mt-1 overflow-x-auto whitespace-nowrap">
                  {c.target}
                </code>
              </Label>
            ))}
          </RadioGroup>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t("deviceOnboarding.iot.channel.hint")}
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

      {/* ── Bước 3 — lược đồ metric ── */}
      {step === 2 && (
        <div className="space-y-4">
          <Alert>
            <Gauge className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t("deviceOnboarding.iot.metrics.hint")}
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            {IOT_METRIC_PRESETS.map((p) => (
              <Button
                key={p.name}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => addMetric(p)}
              >
                <Plus className="h-3 w-3 mr-1" />
                {p.name}
              </Button>
            ))}
          </div>

          {draft.metrics.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("deviceOnboarding.iot.metrics.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {draft.metrics.map((r) => (
                <div key={r.id} className="grid grid-cols-[1.6fr_1fr_auto] gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder={t("deviceOnboarding.iot.metrics.namePlaceholder")}
                    value={r.name}
                    onChange={(e) => updateMetric(r.id, { name: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder={t("deviceOnboarding.iot.metrics.unitPlaceholder")}
                    value={r.unit}
                    onChange={(e) => updateMetric(r.id, { unit: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive hover:text-destructive"
                    onClick={() => removeMetric(r.id)}
                    aria-label={t("deviceOnboarding.iot.metrics.remove")}
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
            onClick={() => addMetric()}
            data-testid="device-onboard-add-metric"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("deviceOnboarding.iot.metrics.add")}
          </Button>

          <StepNav
            onBack={onBack}
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-iot-step2-next"
          />
        </div>
      )}

      {/* ── Bước 4 — credential ── */}
      {step === 3 && (
        <div className="space-y-4">
          <CredentialGuide
            machineLabel={machineLabel}
            suggestedSerialPattern={draft.code}
            acknowledged={draft.credentialAcknowledged}
            onAcknowledgedChange={(v) => update({ credentialAcknowledged: v })}
            showCertOption
            useCert={draft.useCert}
            onUseCertChange={(v) => update({ useCert: v })}
          />
          <StepNav
            onBack={onBack}
            onNext={onNext}
            nextDisabled={!canNext}
            backLabel={t("deviceOnboarding.back")}
            nextLabel={t("deviceOnboarding.next")}
            nextTestId="device-onboard-iot-step3-next"
          />
        </div>
      )}

      {/* ── Bước 5 — sign-off ── */}
      {step === 4 && (
        <SignOff
          rows={[
            [t("deviceOnboarding.iot.deviceType"), machineTypeLabel(t, draft.machineType)],
            [t("deviceOnboarding.iot.code"), draft.code || "—"],
            [
              t("deviceOnboarding.iot.workshop"),
              selectedWorkshop ? `${selectedWorkshop.code} (${virtualStation})` : "—",
            ],
            [
              t("deviceOnboarding.iot.steps.channel"),
              t(`deviceOnboarding.iot.channel.${IOT_CHANNELS.find((c) => c.value === draft.channel)?.key ?? "http"}Title`),
            ],
            [
              t("deviceOnboarding.iot.steps.metrics"),
              t("deviceOnboarding.iot.metrics.count", { n: draft.metrics.filter((r) => r.name.trim()).length }),
            ],
            [
              t("deviceOnboarding.credential.certTitle"),
              draft.useCert ? t("deviceOnboarding.yes") : t("deviceOnboarding.no"),
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
