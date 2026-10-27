/**
 * R1b-2b-2b B-T1 (mục 40) — lỗi 429 của bộ giới hạn thủ tục `TRPC_GIOI_HAN_THU_TUC`.
 *
 * Máy chủ (`server/_core/trpcGioiHanThuTuc.ts`) đặt `retryAfterGiay` ở MỨC TRÊN của
 * `data` (không phải `appParams`) và mã này không nằm trong `appErrorCodes.ts` ⇒ trước
 * bản vá, người dùng en/zh đọc nguyên câu tiếng Việt của máy chủ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapTrpcError } from "./trpcErrors";

import "../i18n";
import i18n from "i18next";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

function loi(retryAfterGiay?: unknown) {
  const e = new Error(
    "Quá nhiều lần thử thao tác nhạy cảm (2fa). Thử lại sau 30 giây.",
  ) as Error & { data: Record<string, unknown> };
  e.data = {
    code: "TOO_MANY_REQUESTS",
    httpStatus: 429,
    appCode: "TRPC_GIOI_HAN_THU_TUC",
    nhom: "2fa",
    ...(retryAfterGiay === undefined ? {} : { retryAfterGiay }),
  };
  return e;
}

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

describe("TRPC_GIOI_HAN_THU_TUC — câu đã dịch kèm số giây thử lại", () => {
  it("vi: câu đã dịch có 30 giây", async () => {
    await i18n.changeLanguage("vi");
    expect(mapTrpcError(loi(30))).toBe(
      "Quá nhiều lần thử thao tác nhạy cảm — thử lại sau 30 giây.",
    );
  });

  it("en / zh: không còn câu tiếng Việt của máy chủ, có số 30", async () => {
    for (const lng of ["en", "zh"]) {
      await i18n.changeLanguage(lng);
      const s = mapTrpcError(loi(30));
      expect(s, lng).toContain("30");
      expect(s, lng).not.toMatch(/Quá nhiều|giây/);
    }
  });

  it("retryAfterGiay vắng / không phải số / < 1 ⇒ 60", async () => {
    await i18n.changeLanguage("vi");
    for (const v of [undefined, "abc", 0, -5, Number.NaN]) {
      expect(mapTrpcError(loi(v)), String(v)).toContain("60 giây");
    }
  });

  it("số lẻ được làm tròn lên thành số nguyên ≥ 1", async () => {
    await i18n.changeLanguage("vi");
    expect(mapTrpcError(loi(29.2))).toContain("30 giây");
  });
});
