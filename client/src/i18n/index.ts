import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// doc 64 S5-OPT V4: vi.json (~769K) KHÔNG nhúng vào bundle chính nữa — nhúng làm JS-literal
// khiến main phình + parse chậm trên CPU yếu. Thay bằng asset ?url: fetch chạy SONG SONG với
// phần còn lại của quá trình eval main, JSON.parse nhanh hơn eval object-literal. main.tsx
// GATE render trên `i18nReady` → không bao giờ flash key thô (honesty giữ nguyên).
import viUrl from './locales/vi.json?url';

export const languages = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
] as const;

export type LanguageCode = typeof languages[number]['code'];

// doc 64 S5-OPT: en/zh (~1.3MB JSON) tải lười khi thật sự được chọn — trong lúc chờ,
// fallbackLng 'vi' hiển thị tiếng Việt (không phải key thô); tải hỏng (offline) → giữ vi.
const lazyLocales: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  zh: () => import('./locales/zh.json'),
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {},
    fallbackLng: 'vi',
    defaultNS: 'translation',
    // Normalize region-tagged detections (e.g. 'en-US' → 'en') so i18n.language
    // always resolves to a supported base code. Without this, a browser reporting
    // 'en-US' left i18n.language === 'en-US', which failed exact-match lookups in
    // the language switcher and silently fell back to the first entry (Vietnamese).
    supportedLngs: ['vi', 'en', 'zh'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    react: {
      useSuspense: false,
    },
  });

// doc 63 (AUD-11 / WCAG 3.1.1 "Language of Page") — index.html ships a static <html lang>,
// but the app is Vietnamese-primary and users switch vi/en/zh at runtime. Keep the document
// language in sync with the active i18next language so assistive tech announces content in
// the right language. SSR-guarded; only ever writes documentElement.lang.
function syncHtmlLang(lng?: string) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = (lng || 'vi').split('-')[0];
  }
}
syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

// doc 64 S5-OPT V4: nạp vi qua fetch (song song với eval main). main.tsx await promise này
// trước khi render → không flash key thô. Fetch hỏng → thử lại 1 lần → vẫn hỏng thì render
// với key thô (chỉ xảy ra khi asset server chết — khi đó app cũng không gọi API được).
async function loadVi(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(viUrl);
      if (!res.ok) throw new Error(`vi.json ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      i18n.addResourceBundle('vi', 'translation', data, true, true);
      return;
    } catch {
      /* thử lại vòng sau */
    }
  }
}
export const i18nReady: Promise<void> = loadVi();

// doc 64 S5-OPT: nạp bundle en/zh khi cần. Sau khi nạp xong, re-emit changeLanguage
// để react-i18next render lại bằng bundle mới (lần 2 hasResourceBundle=true → dừng, không lặp).
async function ensureLocale(lng?: string) {
  const base = (lng || 'vi').split('-')[0];
  const loader = lazyLocales[base];
  if (!loader || i18n.hasResourceBundle(base, 'translation')) return;
  try {
    const mod = await loader();
    i18n.addResourceBundle(base, 'translation', mod.default, true, true);
    if ((i18n.language || '').split('-')[0] === base) {
      await i18n.changeLanguage(i18n.language);
    }
  } catch {
    /* chunk-load fail (offline) → tiếp tục hiển thị vi qua fallbackLng, không crash */
  }
}
void ensureLocale(i18n.language);
i18n.on('languageChanged', (lng) => { void ensureLocale(lng); });

export default i18n;
