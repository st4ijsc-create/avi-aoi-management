/**
 * doc 56 Đ0 việc 6 (C2 — client taxonomy) — MỘT nguồn machine-type cho mọi dropdown.
 *
 * Đọc tRPC `machine.listTypes` → Array<{type, deviceClass, labelKey}> (24 loại,
 * đúng thứ tự enum server). Khi query đang tải hoặc lỗi thì dùng FALLBACK tĩnh
 * (đủ 24 — sync doc 56 Đ0) để dropdown KHÔNG BAO GIỜ trống; có data server thì
 * server thắng (client không fork từ vựng nữa).
 *
 * Cờ `DEVICE_CLASS_UI_ENABLED` (mặc định OFF) theo đúng convention client-flag
 * của repo (appLauncherFlag.ts / useAppLauncherMode.ts): localStorage override
 * ("true"/"false") → VITE env `VITE_DEVICE_CLASS_UI_ENABLED`. ON = dropdown
 * nhóm theo deviceClass; OFF = danh sách phẳng y hệt trước đây.
 */
import { useMemo } from "react";
import type { TFunction } from "i18next";
import { trpc } from "@/lib/trpc";
import type { MachineType } from "@/constants/machineTypes";

export type DeviceClass = "aoi_avi" | "automation" | "iot";

export interface MachineTypeEntry {
  type: MachineType;
  deviceClass: DeviceClass;
  /** "machineType_<TYPE>" — client hiển thị qua namespace `settings.<labelKey>`. */
  labelKey: string;
}

/** Thứ tự render nhóm khi bật cờ (giữ AVI/AOI lên đầu như danh sách phẳng). */
export const DEVICE_CLASS_ORDER: readonly DeviceClass[] = ["aoi_avi", "automation", "iot"];

const entry = (type: MachineType, deviceClass: DeviceClass): MachineTypeEntry => ({
  type,
  deviceClass,
  labelKey: `machineType_${type}`,
});

/**
 * FALLBACK tĩnh — sync doc 56 Đ0 với server/constants/machineTypes.ts
 * (MACHINE_TYPES 24 loại, đúng thứ tự + DEVICE_CLASS_BY_TYPE). CHỈ dùng khi
 * `machine.listTypes` chưa trả data (đang tải/lỗi) — KHÔNG import nơi khác làm
 * nguồn dữ liệu; nguồn chuẩn là server.
 */
export const FALLBACK_MACHINE_TYPES: readonly MachineTypeEntry[] = [
  entry("AVI", "aoi_avi"),
  entry("AOI", "aoi_avi"),
  entry("SPI", "aoi_avi"),
  entry("AXI", "aoi_avi"),
  entry("ICT", "automation"),
  entry("FCT", "automation"),
  entry("CMM", "automation"),
  entry("AUTOMATION", "automation"),
  entry("FEEDER", "automation"),
  entry("ASSEMBLY", "automation"),
  entry("SCREWDRIVE", "automation"),
  entry("DISPENSING", "automation"),
  entry("ICT_FUNC", "automation"),
  entry("ROBOT_TEST", "automation"),
  entry("PACKAGING", "automation"),
  entry("PALLETIZER", "automation"),
  entry("ROBOT", "automation"),
  entry("MOUNTER", "automation"),
  entry("REFLOW", "automation"),
  entry("STENCIL_PRINTER", "automation"),
  entry("WAVE_SOLDER", "automation"),
  entry("WELDER", "automation"),
  entry("IOT_SENSOR", "iot"),
  entry("IOT_GATEWAY", "iot"),
];

const FLAG_KEY = "DEVICE_CLASS_UI_ENABLED";

/**
 * Cờ nhóm-dropdown-theo-deviceClass. Mặc định OFF (trải nghiệm phẳng giữ nguyên).
 * Bật thử per-browser: localStorage.setItem("DEVICE_CLASS_UI_ENABLED", "true");
 * bật theo deployment: VITE_DEVICE_CLASS_UI_ENABLED="true".
 */
export function isDeviceClassUiEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(FLAG_KEY);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {
      /* storage unavailable — dùng env default */
    }
  }
  return import.meta.env.VITE_DEVICE_CLASS_UI_ENABLED === "true";
}

/** Nhãn deviceClass (i18n `settings.deviceClass_<class>`, fallback chính mã class). */
export function deviceClassLabel(t: TFunction, deviceClass: DeviceClass | string): string {
  return t(`settings.deviceClass_${deviceClass}`, { defaultValue: String(deviceClass) });
}

export interface UseMachineTypesResult {
  /** 24 entries, thứ tự enum server (fallback tĩnh khi query chưa có data). */
  types: readonly MachineTypeEntry[];
  /** Chia theo deviceClass, giữ nguyên thứ tự server trong từng nhóm. */
  byClass: Record<DeviceClass, MachineTypeEntry[]>;
  isLoading: boolean;
  /** true = đang phục vụ fallback tĩnh (query đang tải hoặc lỗi). */
  isFallback: boolean;
}

export function useMachineTypes(): UseMachineTypesResult {
  const query = trpc.machine.listTypes.useQuery(undefined, {
    // Từ vựng gần-tĩnh (đổi khi nâng cấp server) — cache dài, không refetch ồn ào.
    staleTime: 60 * 60 * 1000,
  });

  const types: readonly MachineTypeEntry[] = query.data ?? FALLBACK_MACHINE_TYPES;

  const byClass = useMemo(() => {
    const acc: Record<DeviceClass, MachineTypeEntry[]> = { aoi_avi: [], automation: [], iot: [] };
    for (const e of types) (acc[e.deviceClass] ?? acc.automation).push(e);
    return acc;
  }, [types]);

  return { types, byClass, isLoading: query.isLoading, isFallback: !query.data };
}
