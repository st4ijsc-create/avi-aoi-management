import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Scale-aware decimal formatting for a raw metric/measurement value — SPC/telemetry readings span
 * wildly different magnitudes (torque in N·m vs. a leak-test pressure in kPa), so a single fixed
 * `.toFixed(n)` either drowns small values in zeros or floods large ones with noise digits. */
export function formatMetric(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return "0"
  if (abs < 1) return value.toFixed(4)
  if (abs < 10) return value.toFixed(3)
  if (abs < 100) return value.toFixed(2)
  return value.toFixed(1)
}
