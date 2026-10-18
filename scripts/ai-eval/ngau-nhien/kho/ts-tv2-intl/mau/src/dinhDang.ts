export type TienTe = "VND" | "USD";
export type NgonNgu = "vi-VN" | "en-US";
export type MauSoNhieu = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };

export function dinhDangTien(soTien: number, tienTe: TienTe, locale: NgonNgu): string {
  if (!Number.isFinite(soTien)) throw new RangeError(`số tiền không hữu hạn: ${soTien}`);
  return new Intl.NumberFormat(locale, { style: "currency", currency: tienTe }).format(soTien);
}

export function thoiDiemDiaPhuong(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) throw new RangeError(`thời điểm không hợp lệ: ${ms}`);
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(ms)) p[type] = value;
  const m = /^GMT(?:([+-]\d{2}):?(\d{2}))?$/.exec(p.timeZoneName);
  const lech = m && m[1] ? `${m[1]}:${m[2]}` : "+00:00";
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${lech}`;
}

const DUOI_THU_TU: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

export function thuTuTiengAnh(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n phải là số nguyên không âm: ${n}`);
  const loai = new Intl.PluralRules("en-US", { type: "ordinal" }).select(n);
  return `${n}${DUOI_THU_TU[loai] ?? "th"}`;
}

export function soNhieu(n: number, locale: NgonNgu, mau: MauSoNhieu): string {
  const loai = new Intl.PluralRules(locale).select(n);
  const chon = mau[loai] ?? mau.other;
  return chon.replaceAll("#", new Intl.NumberFormat(locale).format(n));
}

const DON_VI: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
];

export function thoiGianTuongDoi(thoiDiem: number, bayGio: number, locale: NgonNgu): string {
  const d = thoiDiem - bayGio;
  const a = Math.abs(d);
  const don = a < 60_000 ? DON_VI[0] : a < 3_600_000 ? DON_VI[1] : a < 86_400_000 ? DON_VI[2] : DON_VI[3];
  const v = Math.trunc(d / don[1]);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(v, don[0]);
}

export function sapXepTen(ds: readonly string[]): string[] {
  const c = new Intl.Collator("vi", { numeric: true });
  return [...ds].sort(c.compare);
}
