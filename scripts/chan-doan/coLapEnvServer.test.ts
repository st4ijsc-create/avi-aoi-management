// Luật vận hành tạm 14/11 — mọi bộ dựng env của server trỏ DB _test phải CÁCH LY khỏi env cha và tắt tường minh các cờ gửi lệnh ra thiết bị.
// Test thuần: không chạy server, không đọc .env, không DB. Bộ dựng của boot-lap.mjs được gọi thật; ba bộ còn lại (không export hàm) kiểm trên NGUỒN.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu
import { dungEnvCoLap, docAlwaysOff, NAM_CO_TAT, BIEN_HE_DIEU_HANH } from "./boot-lap.mjs";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const doc = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

const NAM_CO = ["ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED"];

describe("boot-lap.mjs — dungEnvCoLap", () => {
  const cha = {
    PATH: "C:\\bin", SYSTEMROOT: "C:\\Windows", TEMP: "C:\\tmp",
    BIEN_GIA_CUA_CHA: "lot-vao", JWT_SECRET: "cua-cha", DATABASE_URL: "postgres://cha/aoi_management",
    ROBOT_CONTROL_ENABLED: "true", OT_CONTROL_ENABLED: "true", FOE_ENABLED: "true", FOE_DURABLE: "true", OT_GATEWAY_ENABLED: "true",
  };
  const dung = (ghiDe: Record<string, string> = {}) =>
    dungEnvCoLap(cha, { port: 3016, dbUrl: "postgres://x/aoi_management_test", logDir: ".boot20", ghiDe });

  it("hằng danh sách năm cờ đúng tập đề yêu cầu", () => {
    expect([...NAM_CO_TAT].sort()).toEqual([...NAM_CO].sort());
  });

  it("đủ năm cờ = \"false\" dù cha đặt \"true\"", () => {
    const env = dung();
    for (const k of NAM_CO) expect(env[k], k).toBe("false");
  });

  it("biến lạ và bí mật của cha KHÔNG lọt vào con", () => {
    const env = dung();
    expect(env.BIEN_GIA_CUA_CHA).toBeUndefined();
    expect(env.JWT_SECRET).not.toBe("cua-cha");
    expect(env.JWT_SECRET).toMatch(/^bl-[0-9a-f]{64}$/);
  });

  it("biến hệ điều hành trong danh sách keep được chép, DATABASE_URL lấy từ tham số chứ không từ cha", () => {
    const env = dung();
    expect(env.PATH).toBe("C:\\bin");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.DATABASE_URL).toBe("postgres://x/aoi_management_test");
    expect(env.PORT).toBe("3016");
    expect(BIEN_HE_DIEU_HANH).toContain("PATH");
  });

  it("DOTENV_CONFIG_PATH trỏ tệp không tồn tại, khác .env", () => {
    const p = dung().DOTENV_CONFIG_PATH as string;
    expect(path.basename(p)).not.toBe(".env");
    expect(p).toMatch(/khong-ton-tai\.env$/);
    expect(fs.existsSync(path.resolve(p))).toBe(false);
  });

  it("ALWAYS_OFF của dot5-h6 được áp (vd ROBOT_GATEWAY_ENABLED, MQTT_ENABLED = false)", () => {
    const env = dung();
    expect(env.ROBOT_GATEWAY_ENABLED).toBe("false");
    expect(env.MQTT_ENABLED).toBe("false");
    expect(env.EDGE_RUNTIME_ENABLED).toBe("false");
  });

  it("tham số KEY=VAL ghi đè vẫn hoạt động (giữ hành vi cũ)", () => {
    const env = dung({ PORT: "4000", BIEN_MOI: "co" });
    expect(env.PORT).toBe("4000");
    expect(env.BIEN_MOI).toBe("co");
  });

  it("docAlwaysOff: đọc nguồn thật ra ≥ 10 cờ và ROBOT_CONTROL_ENABLED=false; nguồn hỏng ⇒ ném lỗi", () => {
    const o = docAlwaysOff();
    expect(Object.keys(o).length).toBeGreaterThanOrEqual(10);
    expect(o.ROBOT_CONTROL_ENABLED).toBe("false");
    expect(o.UNS_BROKER_URL).toBe("mqtt://127.0.0.1:9");
    expect(() => docAlwaysOff("export const khac = {};")).toThrow(/ALWAYS_OFF/);
    expect(() => docAlwaysOff('export const ALWAYS_OFF: Record<string, string> = {\n  A_B: "false",\n};')).toThrow(/không hợp lệ/);
  });

  it("nguồn boot-lap.mjs không còn ...process.env", () => {
    expect(doc("scripts/chan-doan/boot-lap.mjs")).not.toMatch(/\.\.\.\s*process\.env/);
  });
});

/** Cắt thân hàm serverEnv (đến dòng `}` đầu cột của hàm). */
function thanServerEnv(nguon: string): string {
  const a = nguon.indexOf("function serverEnv");
  expect(a).toBeGreaterThanOrEqual(0);
  const b = nguon.indexOf("\n}\n", a);
  return nguon.slice(a, b + 3);
}

describe("instance.ts của e2e — FOE_DURABLE tường minh", () => {
  for (const p of ["e2e/flow-studio/instance.ts", "e2e/flow-hanh-trinh/instance.ts"]) {
    it(`${p}: ba cờ ghi đè sau ALWAYS_OFF và không kế thừa env cha`, () => {
      const than = thanServerEnv(doc(p));
      expect(than).not.toMatch(/\.\.\.\s*process\.env/);
      expect(than).toContain("khong-ton-tai.env");
      const sau = than.slice(than.indexOf("ALWAYS_OFF"));
      for (const k of ["FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED", "OT_CONTROL_ENABLED"]) {
        expect(sau, k).toContain(`${k}: "false"`);
      }
    });
  }
});

describe("scripts/ui-metrics/engineeringLayout.mjs — FOE_DURABLE", () => {
  const nguon = doc("scripts/ui-metrics/engineeringLayout.mjs");

  it("ALWAYS_OFF có FOE_DURABLE=false, OT_CONTROL_ENABLED=false, ROBOT_CONTROL_ENABLED=false", () => {
    const m = /const ALWAYS_OFF = \{([\s\S]*?)\n\};/.exec(nguon);
    expect(m).not.toBeNull();
    for (const k of ["FOE_DURABLE", "OT_CONTROL_ENABLED", "ROBOT_CONTROL_ENABLED"]) expect(m![1], k).toContain(`${k}: "false"`);
  });

  it("hành vi dev KHÔNG đổi: FOE_ENABLED vẫn thuộc UI_FLAGS_DEV, FOE_DURABLE thì không (không bị bật theo)", () => {
    const m = /export const UI_FLAGS_DEV = \[([^\]]*)\]/.exec(nguon);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('"FOE_ENABLED"');
    expect(m![1]).not.toContain("FOE_DURABLE");
  });

  it("serverEnv áp ALWAYS_OFF và không kế thừa env cha", () => {
    const than = thanServerEnv(nguon);
    expect(than).toContain("}, ALWAYS_OFF);");
    expect(than).not.toMatch(/\.\.\.\s*process\.env/);
  });
});
