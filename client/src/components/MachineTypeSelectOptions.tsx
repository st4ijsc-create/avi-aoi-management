/**
 * doc 56 Đ0 việc 6 — options dùng chung cho MỌI dropdown chọn loại máy
 * (Step1MachineInfo, MachinesTab, FactorySetupWizard, MQTTReplay).
 *
 * Đặt bên trong `<SelectContent>` của shadcn Select. Nguồn dữ liệu = hook
 * `useMachineTypes` (tRPC machine.listTypes + fallback tĩnh) — client không còn
 * fork danh sách compile-time.
 *
 * Cờ DEVICE_CLASS_UI_ENABLED OFF (mặc định): danh sách PHẲNG y hệt trước đây —
 * 24 SelectItem theo thứ tự enum server. ON: nhóm theo deviceClass
 * (SelectGroup + SelectLabel, nhãn i18n `settings.deviceClass_*`).
 */
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { machineTypeLabel } from "@/lib/machineTypeLabel";
import {
  DEVICE_CLASS_ORDER,
  deviceClassLabel,
  isDeviceClassUiEnabled,
  useMachineTypes,
  type MachineTypeEntry,
} from "@/hooks/useMachineTypes";

function itemsOf(t: TFunction, entries: readonly MachineTypeEntry[]) {
  return entries.map((e) => (
    <SelectItem key={e.type} value={e.type}>
      {machineTypeLabel(t, e.type)}
    </SelectItem>
  ));
}

export function MachineTypeSelectOptions(): React.JSX.Element {
  const { t } = useTranslation();
  const { types, byClass } = useMachineTypes();

  if (!isDeviceClassUiEnabled()) {
    // Mặc định — danh sách phẳng giữ nguyên trải nghiệm hiện tại.
    return <>{itemsOf(t, types)}</>;
  }

  return (
    <>
      {DEVICE_CLASS_ORDER.map((dc) =>
        byClass[dc].length === 0 ? null : (
          <SelectGroup key={dc}>
            <SelectLabel>{deviceClassLabel(t, dc)}</SelectLabel>
            {itemsOf(t, byClass[dc])}
          </SelectGroup>
        ),
      )}
    </>
  );
}
