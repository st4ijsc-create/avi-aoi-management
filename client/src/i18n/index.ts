import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import vi from './locales/vi.json';
import en from './locales/en.json';
import zh from './locales/zh.json';

export const languages = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
] as const;

export type LanguageCode = typeof languages[number]['code'];

const resources = {
  vi: { translation: vi },
  en: { translation: en },
  zh: { translation: zh },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
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

export default i18n;
