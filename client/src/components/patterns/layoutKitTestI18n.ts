/**
 * Doc 81 Đợt 2 Task 3 — i18next THẬT với `vi.json` cho test DOM của bộ layout dùng chung.
 * Chỉ test import tệp này (không phải *.test.* nên vitest không thu thập). Dùng bản dịch thật
 * thay cho mock `t = (k, d) => d`: khoá thiếu trong vi.json thì test thấy CHUỖI DỰ PHÒNG/KHOÁ,
 * không phải câu tiếng Việt, nên ca kiểm chữ sẽ đỏ.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import vi from "@/i18n/locales/vi.json";

let ready: Promise<unknown> | null = null;

export function initLayoutKitTestI18n(): Promise<unknown> {
  if (!ready) {
    ready = i18next.use(initReactI18next).init({
      lng: "vi",
      fallbackLng: false,
      resources: { vi: { translation: vi as Record<string, unknown> } },
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }
  return ready;
}
