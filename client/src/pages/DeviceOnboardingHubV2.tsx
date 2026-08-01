// Doc 56 Đợt 2 việc 5 (Đ2b nhóm 1) — Wizard hợp nhất "Thêm thiết bị" V2.
//
// MỘT điểm vào duy nhất để đưa MỌI loại thiết bị lên nền tảng:
//   • Bước 0 — chọn deviceClass (aoi_avi | automation | iot) qua `useMachineTypes`.
//   • aoi_avi  → tái dùng NGUYÊN VẸN `AoiOnboardingWizardContent` (deploy-model chỉ
//     ở nhánh này — 5 bước resumable đã wire backend thật).
//   • automation → nhánh 6 bước (thông tin → giao thức → recipe → guardrail →
//     credential → sign-off) theo doc 57.
//   • iot → nhánh 5 bước (thông tin → kênh → metric → credential → sign-off).
//
// CLIENT-ONLY, cờ `DEVICE_ONBOARD_WIZARD_V2_ENABLED` mặc định OFF. Component tự
// kiểm cờ: OFF → fallback an toàn (orchestrator sẽ gate route + TAB_REDIRECTS sau).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Cpu, PackagePlus, ScanSearch, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DEVICE_CLASS_ORDER,
  deviceClassLabel,
  useMachineTypes,
  type DeviceClass,
} from "@/hooks/useMachineTypes";
import { AoiOnboardingWizardContent } from "@/pages/AoiOnboardingWizard";
import { AutomationBranch } from "@/components/deviceOnboarding/AutomationBranch";
import { IotBranch } from "@/components/deviceOnboarding/IotBranch";
import { isDeviceOnboardWizardV2Enabled } from "@/components/deviceOnboarding/types";

const CLASS_ICON: Record<DeviceClass, LucideIcon> = {
  aoi_avi: ScanSearch,
  automation: Wrench,
  iot: Cpu,
};

function ClassChooser({ onPick }: { onPick: (dc: DeviceClass) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const { byClass } = useMachineTypes();

  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="device-onboard-class-chooser">
      {DEVICE_CLASS_ORDER.map((dc) => {
        const Icon = CLASS_ICON[dc];
        const count = byClass[dc]?.length ?? 0;
        return (
          <button
            key={dc}
            type="button"
            data-testid={`device-onboard-class-${dc}`}
            onClick={() => onPick(dc)}
            className="rounded-lg border p-5 text-left transition-colors hover:bg-accent hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-center justify-between gap-2">
              <Icon className="h-7 w-7 text-primary" />
              <Badge variant="secondary" className="text-[10px]">
                {t("deviceOnboarding.chooser.typeCount", { n: count })}
              </Badge>
            </div>
            <div className="mt-3 font-medium">{deviceClassLabel(t, dc)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`deviceOnboarding.chooser.${dc}Desc`)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function ChangeClassBar({ onChangeClass }: { onChangeClass: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <Button variant="ghost" size="sm" onClick={onChangeClass}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        {t("deviceOnboarding.changeClass")}
      </Button>
    </div>
  );
}

function DisabledFallback(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t("deviceOnboarding.disabled.title")}</CardTitle>
          <CardDescription>{t("deviceOnboarding.disabled.desc")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export function DeviceOnboardingHubV2Content(): React.JSX.Element {
  const { t } = useTranslation();
  const [deviceClass, setDeviceClass] = useState<DeviceClass | null>(null);

  // Tự kiểm cờ — OFF → fallback an toàn (orchestrator gate route sau).
  if (!isDeviceOnboardWizardV2Enabled()) {
    return <DisabledFallback />;
  }

  if (deviceClass === null) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <PageHeader
          title={t("deviceOnboarding.title")}
          description={t("deviceOnboarding.subtitle")}
        />
        <ClassChooser onPick={setDeviceClass} />
      </div>
    );
  }

  if (deviceClass === "aoi_avi") {
    return (
      <div className="space-y-3 max-w-3xl mx-auto">
        <ChangeClassBar onChangeClass={() => setDeviceClass(null)} />
        {/* deploy-model chỉ ở nhánh này — tái dùng nguyên vẹn */}
        <AoiOnboardingWizardContent />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {deviceClass === "automation" ? (
        <AutomationBranch onChangeClass={() => setDeviceClass(null)} />
      ) : (
        <IotBranch onChangeClass={() => setDeviceClass(null)} />
      )}
    </div>
  );
}

export default function DeviceOnboardingHubV2(): React.JSX.Element {
  return (
    <DashboardLayout title="SYNAPSE" navItems={navItems} currentPath="/device-onboarding">
      <DeviceOnboardingHubV2Content />
    </DashboardLayout>
  );
}

// Icon dùng ở menu/launcher (nếu orchestrator cần) — export phụ, không bắt buộc.
export const deviceOnboardingHubIcon = PackagePlus;
