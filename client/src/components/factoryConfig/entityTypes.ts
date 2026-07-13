/**
 * doc 47 Đợt 4 (tech-debt) — shared row types for the factory-config CRUD tabs,
 * lifted VERBATIM from DataSettings.tsx so the extracted tab components and the
 * orchestrator share one source of truth. No shape changes.
 */
export type Factory = { id: number; code: string; name: string; address?: string | null; description?: string | null };
export type Workshop = { id: number; factoryId: number; code: string; name: string; description?: string | null };
export type Line = { id: number; workshopId: number; code: string; name: string; description?: string | null };
export type Station = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null };
export type Machine = { id: number; stationId: number; code: string; name: string; machineType: string; apiKey?: string | null; model?: string | null; manufacturer?: string | null; image2DUrl?: string | null; image3DUrl?: string | null; [key: string]: any };
export type ShiftConfig = { id: number; factoryId?: number | null; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number; isActive: boolean; orderIndex: number };
export type LineStage = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null; stationId?: number | null };
