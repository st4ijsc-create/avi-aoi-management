// PHATLAI-ENV-KHONG-LOC (HST 20/11): fixture phát lại không mang biến dáng bí mật; dongGoi.ts lọc `moiTruong` qua `locCo`; boSungMoiTruong.cjs bị khoá.
// (iii) là kiểm TĨNH nguồn (điểm yếu có tên PHATLAI-KIEM-TINH): không chạy dongGoi.ts thật (cần CSDL + bản thô của cửa sổ GPU).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locCo } from "../tasks/run-eval.mjs";

const DAY = path.dirname(fileURLToPath(import.meta.url));
const THU_MUC_FX = path.resolve(DAY, "../../../server/testing/fixtures/phat-lai");
const docNguon = (ten: string) => fs.readFileSync(path.join(DAY, ten), "utf8").replace(/\r\n/g, "\n"); // CRLF bản làm việc ⇒ LF
describe("fixture phát lại và bộ lọc locCo", () => {
  it("(i) mọi fixture: locCo giữ đủ tên của lenh.moiTruong, boQua rỗng", () => {
    const tep = fs.readdirSync(THU_MUC_FX).filter((t) => t.endsWith(".json.gz"));
    expect(tep.length).toBeGreaterThanOrEqual(6); // 20/11: 6 tệp; glob rỗng không được xanh lặng
    for (const t of tep) {
      const moiTruong = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(THU_MUC_FX, t))).toString("utf8")).lenh.moiTruong as Record<string, string>;
      const { co, boQua } = locCo(moiTruong);
      expect(boQua, t).toEqual([]);
      expect(Object.keys(co).sort(), t).toEqual(Object.keys(moiTruong).sort());
    }
  });
  it("(ii) tên dáng bí mật ⇒ boQua (chỉ TÊN); MAX_TOKENS giữ; tên lẫn hoa/thường bỏ LẶNG LẼ theo tiền tố", () => {
    const { co, boQua } = locCo({
      AI_AGENTIC_ACCESS_TOKEN: "true", AI_AGENT_API_KEY: "1", AI_CODING_X_SECRET: "on", AI_AGENT_MAX_TOKENS_MOT_LUOT: "800", // giá trị GIẢ dạng cờ, qua lớp GIÁ TRỊ ⇒ chỉ lớp TÊN loại
      ai_agent_api_key: "true", AI_Agent_Secret: "true",
    });
    expect(co).toEqual({ AI_AGENT_MAX_TOKENS_MOT_LUOT: "800" });
    expect(boQua).toEqual(["AI_AGENTIC_ACCESS_TOKEN", "AI_AGENT_API_KEY", "AI_CODING_X_SECRET"]); // không có hai tên lẫn hoa/thường
  });
});
describe("(iii) kiểm TĨNH nguồn — PHATLAI-KIEM-TINH", () => {
  it("dongGoi.ts ghi vào fixture phần `co` của locCo, không ghi moiTruong thô", () => {
    const nguon = docNguon("dongGoi.ts");
    expect(nguon).toMatch(/^import \{ locCo \} from "\.\.\/tasks\/run-eval\.mjs";$/m);
    expect(nguon).toMatch(/const \{ co \} = locCo\(moiTruong\);/);
    expect(nguon).toMatch(/^\s*moiTruong: co,$/m);
    expect(nguon).not.toMatch(/^\s*moiTruong,$/m);
  });
  it("boSungMoiTruong.cjs: dòng mã đầu tiên là throw (khoá, không đọc .env)", () => {
    const dau = docNguon("boSungMoiTruong.cjs").split("\n").find((d) => d.trim() !== "" && !d.trim().startsWith("//"));
    expect(dau).toMatch(/^throw new Error\(/);
  });
});
