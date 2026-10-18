/** Ca 8 giờ, CA1 bắt đầu lúc gioBatDau (giờ UTC). Ca có thể vắt qua nửa đêm. */
export function caCuaMoc(isoUtc, gioBatDau) {
  const h = new Date(isoUtc).getUTCHours();
  const d = ((h - gioBatDau) % 24 + 24) % 24;
  return "CA" + (Math.floor(d / 8) + 1);
}
