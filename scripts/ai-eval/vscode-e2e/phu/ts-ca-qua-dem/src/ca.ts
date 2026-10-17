export type MaCa = "CA1" | "CA2" | "CA3";

export const DO_DAI_CA = 8;
export const DS_CA: readonly MaCa[] = ["CA1", "CA2", "CA3"];

/** Ca của một giờ trong ngày (0–23); ca 1 bắt đầu lúc `gioBatDau` (0–23). */
export function caCuaGio(gio: number, gioBatDau: number): MaCa {
  const lech = gio - gioBatDau;
  return DS_CA[Math.floor(lech / DO_DAI_CA)];
}
