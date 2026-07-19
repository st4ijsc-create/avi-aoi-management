import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

const localeMap = { en: "en-US", vi: "vi-VN", zh: "zh-CN" } as const;

function resolveLocale(lang: string | undefined): string {
  if (!lang) return "en-US";
  const base = lang.split("-")[0] as keyof typeof localeMap;
  return localeMap[base] ?? "en-US";
}

/** Returns the resolved BCP-47 locale for the currently active i18n language. */
export function getActiveLocale(): string {
  return resolveLocale(i18n.language);
}

/**
 * i18n-aware date formatters bound to the current i18next language.
 * Use inside React components.
 */
export function useLocaleDate() {
  const { i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  return {
    short: (d: Date | string | number) => new Date(d).toLocaleDateString(locale),
    long: (d: Date | string | number) =>
      new Date(d).toLocaleDateString(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    dateTime: (d: Date | string | number) =>
      new Date(d).toLocaleString(locale),
  };
}

/** Non-hook variant for places where a language code is already known. */
export function formatLocaleDate(
  d: Date | string | number,
  lang: string | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(d).toLocaleDateString(resolveLocale(lang), opts);
}

/* ════════════════════════════════════════════════════════════════════════════
 * doc 67 W7 GĐ1 — bộ formatter số/thời-gian DÙNG CHUNG (nguồn duy nhất).
 *
 * Hợp nhất các bản local đã trôi lệch nhau: PanelShell pct/num/int,
 * ControlTower fmtNum/fmtPct, AndonBoard fmtPct, ExecutiveMobile
 * fmtPct/fmtInt/fmtIntCompact, CommandCenter relTime, andonBoard.agoLabel,
 * opsconsole ageLabel. Quy ước "trung thực": null/undefined/NaN → '—'
 * (KHÔNG BAO GIỜ bịa số 0).
 * ════════════════════════════════════════════════════════════════════════════ */

/** null/undefined/NaN → true (mọi formatter dưới đây trả '—' cho trường hợp này). */
function isBlank(v: number | null | undefined): v is null | undefined {
  return v == null || Number.isNaN(v);
}

/**
 * Phần trăm — quy ước ĐÃ CHỐT (doc 67): 1 chữ số thập phân; khi giá trị TRÒN
 * và ≥100 thì bỏ phần thập phân → "100%" (không bao giờ "100.0%").
 * null/undefined/NaN → '—'. KHÔNG tự nhân 100 — caller truyền giá trị 0–100.
 *
 * @example fmtPct(87.35) → "87.4%" · fmtPct(100) → "100%" · fmtPct(null) → "—"
 */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (isBlank(v)) return "—";
  let s = v.toFixed(digits);
  if (v >= 100) s = s.replace(/\.0+$/, "");
  return `${s}%`;
}

/**
 * Số có tách nghìn theo locale đang chọn (vi → "1.234.567").
 * null/undefined/NaN → '—'. Giữ nguyên phần thập phân của giá trị.
 */
export function fmtNum(v: number | null | undefined): string {
  if (isBlank(v)) return "—";
  return v.toLocaleString(getActiveLocale());
}

/** Số NGUYÊN (Math.round) tách nghìn theo locale. null/undefined/NaN → '—'. */
export function fmtInt(v: number | null | undefined): string {
  if (isBlank(v)) return "—";
  return Math.round(v).toLocaleString(getActiveLocale());
}

/**
 * Số nguyên NÉN cho KPI lớn (chuẩn hóa từ bản ExecutiveMobile — doc 67 W4.3):
 * |v| ≥ 1.000.000 → Intl compact ("1,23 Tr" vi · "1.23M" en · "123万" zh);
 * dưới ngưỡng giữ nguyên tách nghìn đầy đủ (số chính xác không bị nén).
 * null/undefined/NaN → '—'.
 *
 * @param lang mã ngôn ngữ i18n ("vi"/"en"/"zh"…); bỏ trống → ngôn ngữ đang chọn.
 */
export function fmtIntCompact(v: number | null | undefined, lang?: string): string {
  if (isBlank(v)) return "—";
  const locale = resolveLocale(lang ?? i18n.language);
  const rounded = Math.round(v);
  if (Math.abs(rounded) >= 1_000_000) {
    try {
      return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(rounded);
    } catch {
      /* Intl compact lỗi (môi trường cũ) → rơi xuống tách nghìn đầy đủ. */
    }
  }
  return rounded.toLocaleString(locale);
}

/**
 * Tuổi tương-đối SIÊU GỌN: "5s" / "3m" / "2h" / "4d" (có bậc NGÀY — hợp nhất
 * CommandCenter.relTime + andonBoard.agoLabel + PanelShell.relTimeShort).
 * Nhận ms-epoch, Date hoặc chuỗi ISO; null/undefined/parse-hỏng → '—'.
 * Tương lai (ts > now) kẹp về "0s" — không hiện số âm.
 *
 * @param now mốc hiện tại (ms) — truyền vào từ tick của trang để mọi nhãn
 *            trên cùng khung hình đồng bộ; bỏ trống → Date.now().
 */
export function relTimeShort(
  ts: number | string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (ts == null) return "—";
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === "string" ? Date.parse(ts) : ts;
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
