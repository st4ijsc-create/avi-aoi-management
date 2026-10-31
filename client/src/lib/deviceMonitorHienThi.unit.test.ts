/**
 * C2 2.1 — màn Giám sát thiết bị hợp nhất với adapter bị che: endpoint null ⇒ "—"; kết quả thử kết nối không có `error` ⇒ câu DỊCH của
 * `errorCode` (không "unknown"). Bundle i18n THẬT; mỗi ca đổi ngôn ngữ tường minh.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../i18n";
import i18n from "i18next";
import { chiTietAdapter, lyDoThuKetNoi } from "./deviceMonitorHienThi";

const HERE = dirname(fileURLToPath(import.meta.url));
const locale = (l: string) => JSON.parse(readFileSync(join(HERE, `../i18n/locales/${l}.json`), "utf8"));

beforeAll(() => {
  for (const l of ["vi", "en", "zh"]) i18n.addResourceBundle(l, "translation", locale(l), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

describe("chiTietAdapter", () => {
  it("★ null / undefined ⇒ '—' (không để trống, không 'null')", () => {
    expect(chiTietAdapter(null)).toBe("—");
    expect(chiTietAdapter(undefined)).toBe("—");
  });
  it("kỹ sư: giữ nguyên endpoint", () => {
    expect(chiTietAdapter("opc.tcp://10.0.0.5:4840")).toBe("opc.tcp://10.0.0.5:4840");
  });
});

describe("lyDoThuKetNoi", () => {
  const BI_CHE = { errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "modbus" } };

  it("★ chỉ có errorCode/errorParams ⇒ câu dịch (vi/en/zh), không 'unknown', không mã trần", async () => {
    const cau: string[] = [];
    for (const l of ["vi", "en", "zh"]) {
      await i18n.changeLanguage(l);
      const s = lyDoThuKetNoi(BI_CHE);
      expect(s).not.toBe("unknown");
      expect(s).not.toBe("DEVICE_UNREACHABLE");
      cau.push(s);
    }
    expect(new Set(cau).size).toBe(3);
    await i18n.changeLanguage("vi");
  });

  it("★ errorParams được truyền cho câu dịch (kiem-dinh u33): tham số khác nhau ⇒ câu khác nhau", async () => {
    await i18n.changeLanguage("vi");
    const a = lyDoThuKetNoi({ errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "modbus" } });
    const b = lyDoThuKetNoi({ errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "opcua" } });
    expect(a).not.toBe(b);
    expect(a).toMatch(/modbus/i);
    expect(b).toMatch(/opc/i);
  });

  it("kỹ sư: có văn bản driver ⇒ hiện văn bản đó", () => {
    expect(lyDoThuKetNoi({ ...BI_CHE, error: "connect ECONNREFUSED 10.0.0.5:502" })).toBe("connect ECONNREFUSED 10.0.0.5:502");
  });

  it("không có gì ⇒ 'unknown'", () => {
    expect(lyDoThuKetNoi({})).toBe("unknown");
  });
});
