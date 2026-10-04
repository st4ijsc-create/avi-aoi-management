/**
 * doc 81 Đợt 2 Task 12 — hằng số loại chương trình của IDE (`/engineering`), tách nguyên văn từ
 * `pages/EngineeringWorkspace.tsx` để reducer của WorkspaceContext và các card (Task 13) dùng chung.
 */

/** All target classes (mirrors server programmingKindEnum / PROGRAMMING_KINDS). */
export const KINDS = [
  "stub",
  "zmotion-basic",
  "gcode",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
] as const;
export type Kind = (typeof KINDS)[number];

/** Default concrete language token per kind (the adapter accepts these). */
export const KIND_LANGUAGE: Record<Kind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "st",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
};

/**
 * U9 (doc 26) — tập token ngôn ngữ HỢP LỆ mỗi kind (mirror capabilities.languages
 * của adapter server). Đổi ô gõ tay → Select để khỏi gõ sai token adapter hiểu nhầm.
 * Phần tử đầu là mặc định gợi ý cho kind (khớp KIND_LANGUAGE).
 */
export const KIND_LANGUAGES: Record<Kind, readonly string[]> = {
  stub: ["text", "basic", "st", "gcode"],
  "zmotion-basic": ["basic"],
  gcode: ["gcode"],
  "mitsubishi-engineering": ["st", "device"],
  "robot-tm": ["tmscript"],
  "iec61131-st": ["st"],
  "iec61131-ld": ["ld"],
};
