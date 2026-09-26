/**
 * Sprint F2 — localized label for a machine type.
 *
 * Reads i18n key `settings.machineType_<TYPE>` with a FALLBACK of the raw type
 * code, so a machine type that is missing a label never breaks the UI.
 */
import type { TFunction } from "i18next";

export function machineTypeLabel(t: TFunction, type: string): string {
  // doc65 V5: fallback KHÔNG được lộ enum thô (IOT_SENSOR) — degrade tử tế:
  // bỏ gạch dưới + Title-case khi thiếu key dịch.
  const cleaned = type.replace(/_/g, " ").toLowerCase();
  const pretty = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return t(`settings.machineType_${type}`, { defaultValue: pretty });
}
