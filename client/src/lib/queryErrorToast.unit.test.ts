/**
 * F11 (nhóm C 2026-08-14) — gộp toast lỗi query.
 *
 * BỆNH: React Query v5 bỏ `onError` khỏi `useQuery`, nên 1310 query không có chỗ xử lý
 * lỗi riêng; handler toàn cục chỉ `console.error` ⇒ `DB_UNAVAILABLE` KHÔNG hiện gì.
 * NHƯNG bắn thẳng cũng sai: DB sập là mọi query hỏng cùng lúc ⇒ bão toast.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  queryErrorToastKey,
  shouldToastQueryError,
  resetQueryErrorToastState,
  CUA_SO_GOP_MS,
} from "./queryErrorToast";

function loi(message: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(message), { data });
}

beforeEach(() => resetQueryErrorToastState());

describe("queryErrorToastKey — gộp theo MÃ, không theo câu chữ", () => {
  it("có appCode ⇒ khoá theo mã", () => {
    expect(queryErrorToastKey(loi("bất kỳ", { appCode: "DB_UNAVAILABLE" }))).toBe("code:DB_UNAVAILABLE");
  });

  it("cùng mã nhưng message KHÁC nhau ⇒ CÙNG khoá (đây là điểm mấu chốt)", () => {
    const a = loi("Database not available", { appCode: "DB_UNAVAILABLE" });
    const b = loi("DB not connected", { appCode: "DB_UNAVAILABLE" });
    expect(queryErrorToastKey(a)).toBe(queryErrorToastKey(b));
  });

  it("mã KHÁC nhau ⇒ khoá khác (không nuốt nhầm lỗi thứ hai)", () => {
    const a = loi("x", { appCode: "DB_UNAVAILABLE" });
    const b = loi("x", { appCode: "ENTITY_NOT_FOUND" });
    expect(queryErrorToastKey(a)).not.toBe(queryErrorToastKey(b));
  });

  it("chưa di trú (không appCode) ⇒ lùi về message, vẫn tách được hai lỗi khác nhau", () => {
    expect(queryErrorToastKey(loi("A"))).not.toBe(queryErrorToastKey(loi("B")));
  });

  it("đầu vào rác ⇒ 'unknown', không ném", () => {
    expect(queryErrorToastKey(undefined)).toBe("unknown");
    expect(queryErrorToastKey(null)).toBe("unknown");
    expect(queryErrorToastKey({})).toBe("unknown");
  });
});

describe("shouldToastQueryError — DB sập cho ra MỘT câu, không phải bốn mươi", () => {
  it("40 query cùng hỏng vì DB ⇒ chỉ 1 lần bắn", () => {
    const key = queryErrorToastKey(loi("Database not available", { appCode: "DB_UNAVAILABLE" }));
    const banRa = Array.from({ length: 40 }, () => shouldToastQueryError(key, 1_000)).filter(Boolean);
    expect(banRa).toHaveLength(1);
  });

  it("hai MÃ khác nhau cùng lúc ⇒ mỗi mã một câu, không nuốt nhau", () => {
    const now = 1_000;
    expect(shouldToastQueryError("code:DB_UNAVAILABLE", now)).toBe(true);
    expect(shouldToastQueryError("code:ENTITY_NOT_FOUND", now)).toBe(true);
  });

  it("hết cửa sổ ⇒ báo lại (lỗi kéo dài vẫn phải nhắc)", () => {
    expect(shouldToastQueryError("k", 0)).toBe(true);
    expect(shouldToastQueryError("k", CUA_SO_GOP_MS - 1)).toBe(false);
    expect(shouldToastQueryError("k", CUA_SO_GOP_MS)).toBe(true);
  });

  it("biên đúng bằng cửa sổ ⇒ được bắn (>=, không phải >)", () => {
    shouldToastQueryError("b", 5_000);
    expect(shouldToastQueryError("b", 5_000 + CUA_SO_GOP_MS)).toBe(true);
  });

  it("cửa sổ tuỳ chỉnh được", () => {
    expect(shouldToastQueryError("c", 0, 100)).toBe(true);
    expect(shouldToastQueryError("c", 50, 100)).toBe(false);
    expect(shouldToastQueryError("c", 100, 100)).toBe(true);
  });
});
