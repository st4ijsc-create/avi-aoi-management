// WS-2 — Machine Onboarding Wizard (5 steps): info → test → assign/approve →
// product+model deploy → verify heartbeat. Goal: bring a new machine online in
// under 10 minutes.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Step1MachineInfo from "@/components/onboarding/Step1MachineInfo";
import Step2TestConnection from "@/components/onboarding/Step2TestConnection";
import Step3AssignStation from "@/components/onboarding/Step3AssignStation";
import Step4DeployModel from "@/components/onboarding/Step4DeployModel";
import Step5Verify from "@/components/onboarding/Step5Verify";
import AISetupSuggestion from "@/components/onboarding/AISetupSuggestion";
import { initialWizardState, type WizardState } from "@/components/onboarding/types";

export function MachineOnboardingWizardContent() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialWizardState);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const onNext = () => setStep((s) => Math.min(s + 1, 4));
  const onBack = () => setStep((s) => Math.max(s - 1, 0));

  const stepTitles = [
    t("onboarding.steps.info"),
    t("onboarding.steps.test"),
    t("onboarding.steps.assign"),
    t("onboarding.steps.deploy"),
    t("onboarding.steps.verify"),
  ];

  const stepProps = { state, update, onNext, onBack };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title={t("onboarding.title")}
        description={t("onboarding.subtitle")}
      />

      {/* Stepper */}
      <div className="flex items-center justify-between">
        {stepTitles.map((title, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border",
                i < step ? "bg-success text-success-foreground border-success"
                  : i === step ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground",
              )}>
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

      {/* LUỒNG ① — AI Setup Advisor: pre-fill from the most similar machine.
          Shown on Step 1 (machine type chosen) and Step 4 (product chosen). */}
      {(step === 0 || step === 3) && <AISetupSuggestion {...stepProps} />}

      <Card>
        <CardHeader>
          <CardTitle>{stepTitles[step]}</CardTitle>
          <CardDescription>{t(`onboarding.stepDesc.${step}`)}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 0 && <Step1MachineInfo {...stepProps} />}
          {step === 1 && <Step2TestConnection {...stepProps} />}
          {step === 2 && <Step3AssignStation {...stepProps} />}
          {step === 3 && <Step4DeployModel {...stepProps} />}
          {step === 4 && <Step5Verify {...stepProps} />}
        </CardContent>
      </Card>

      {step === 4 && (
        <div className="flex justify-end">
          <Button onClick={() => navigate("/machine-registration")}>
            {t("onboarding.finish")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MachineOnboardingWizard() {
  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/machine-onboarding">
      <MachineOnboardingWizardContent />
    </DashboardLayout>
  );
}
