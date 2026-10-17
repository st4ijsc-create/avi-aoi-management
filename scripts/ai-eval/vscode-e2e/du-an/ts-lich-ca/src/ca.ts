export type MaCa = "CA1" | "CA2" | "CA3";

export const DO_DAI_CA = 8;
export const DS_CA: readonly MaCa[] = ["CA1", "CA2", "CA3"];

function kiemGio(ten: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 23) throw new RangeError(`${ten} phải là số nguyên 0–23`);
}

/** Ca của một giờ trong ngày (0–23); ca 1 bắt đầu lúc `gioBatDau` (0–23); ca có thể vắt qua nửa đêm. */
export function caCuaGio(gio: number, gioBatDau: number): MaCa {
  kiemGio("gio", gio);
  kiemGio("gioBatDau", gioBatDau);
  const lech = (((gio - gioBatDau) % 24) + 24) % 24;
  return DS_CA[Math.floor(lech / DO_DAI_CA)];
}
