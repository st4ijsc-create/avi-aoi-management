/**
 * Sprint F2 — localized label for a machine type.
 *
 * Reads i18n key `settings.machineType_<TYPE>` with a FALLBACK of the raw type
 * code, so a machine type that is missing a label never breaks the UI.
 */
import type { TFunction } from "i18next";

export function machineTypeLabel(t: TFunction, type: string): string {
  return t(`settings.machineType_${type}`, { defaultValue: type });
}
