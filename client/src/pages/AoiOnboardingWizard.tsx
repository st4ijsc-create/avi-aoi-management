// W2-D (doc 27 §3 gap C4) — "Kết nối máy AOI/AVI" wizard (/aoi-onboarding):
// onboard a REAL inspection machine in ≤10 minutes without code changes.
// 5 steps: ① machine + vendor adapter (dynamic registry) → ② data source
// (hot-folder / HTTP push) → ③ dry-run validate a sample export → ④ credential
// (show-once key) → ⑤ commissioning sign-off (audited; flips ingest to
// "production" — SOFT gate, un-commissioned machines are only tagged).
// State is resumable: a draft record is kept server-side from step 1.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { trpc } from "@/lib/trpc";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Step1MachineVendor from "@/components/aoiOnboarding/Step1MachineVendor";
import Step2DataSource from "@/components/aoiOnboarding/Step2DataSource";
import Step3DryRun from "@/components/aoiOnboarding/Step3DryRun";
import Step4Credential from "@/components/aoiOnboarding/Step4Credential";
import Step5SignOff from "@/components/aoiOnboarding/Step5SignOff";
import {
  buildSnapshot,
  initialAoiWizardState,
  type AoiWizardState,
} from "@/components/aoiOnboarding/types";

export function AoiOnboardingWizardContent() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<AoiWizardState>(initialAoiWizardState);

  const update = (patch: Partial<AoiWizardState>) => setState((s) => ({ ...s, ...patch }));

  // Resumable draft — persisted fire-and-forget on step transitions.
  const saveDraftMutation = trpc.aoiOnboarding.saveDraft.useMutation();
  const persistDraft = useCallback(
    (atStep?: number) => {
      setState((s) => {
        if (s.machineId) {
          saveDraftMutation.mutate({
            machineId: s.machineId,
            configSnapshot: buildSnapshot(s, atStep ?? step) as Record<string, unknown>,
          });
        }
        return s;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step],
  );

  const onNext = () =>
    setStep((s) => {
      const next = Math.min(s + 1, 4);
      persistDraft(next);
      return next;
    });
  const onBack = () => setStep((s) => Math.max(s - 1, 0));
  const goToStep = (n: number) => setStep(Math.min(Math.max(n, 0), 4));

  const stepTitles = [
    t("aoiOnboarding.steps.machine"),
    t("aoiOnboarding.steps.source"),
    t("aoiOnboarding.steps.dryrun"),
    t("aoiOnboarding.steps.credential"),
    t("aoiOnboarding.steps.signoff"),
  ];

  const stepProps = { state, update, onNext, onBack, goToStep, persistDraft: () => persistDraft() };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title={t("aoiOnboarding.title")}
        description={t("aoiOnboarding.subtitle")}
      />

      {/* Stepper (mirrors MachineOnboardingWizard) */}
      <div className="flex items-center justify-between">
        {stepTitles.map((title, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border",
                  i < step
                    ? "bg-success text-success-foreground border-success"
                    : i === step
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className="text-xs mt-1 text-center w-20">{title}</span>
            </div>
            {i < stepTitles.length - 1 && (
              <div className={cn("h-0.5 flex-1 mx-2", i < step ? "bg-success" : "bg-muted")} />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{stepTitles[step]}</CardTitle>
          <CardDescription>{t(`aoiOnboarding.stepDesc.${step}`)}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 0 && <Step1MachineVendor {...stepProps} />}
          {step === 1 && <Step2DataSource {...stepProps} />}
          {step === 2 && <Step3DryRun {...stepProps} />}
          {step === 3 && <Step4Credential {...stepProps} />}
          {step === 4 && <Step5SignOff {...stepProps} />}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AoiOnboardingWizard() {
  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/aoi-onboarding">
      <AoiOnboardingWizardContent />
    </DashboardLayout>
  );
}
