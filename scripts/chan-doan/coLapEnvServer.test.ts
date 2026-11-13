// Luật vận hành tạm 14/11 — mọi bộ dựng env của server trỏ DB _test phải CÁCH LY khỏi env cha và tắt tường minh các cờ gửi lệnh ra thiết bị.
// Test thuần: không chạy server, không đọc .env, không DB. Bộ dựng của boot-lap.mjs được gọi thật; ba bộ còn lại (không export hàm) kiểm trên NGUỒN.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu
import { dungEnvCoLap, docAlwaysOff, NAM_CO_TAT, BIEN_HE_DIEU_HANH, KHOA_CAM_GHI_DE, KHOA_CAM_MOI_GIA_TRI } from "./boot-lap.mjs";

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

  it("ROLE = api", () => {
    expect(dung().ROLE).toBe("api");
  });

  it("KEY=VAL hợp lệ (PORT, BIEN_MOI) vẫn ghi đè được", () => {
    const env = dung({ PORT: "4000", BIEN_MOI: "co" });
    expect(env.PORT).toBe("4000");
    expect(env.BIEN_MOI).toBe("co");
    for (const k of NAM_CO) expect(env[k], k).toBe("false");
  });

  it("KEY=VAL chạm năm cờ / DATABASE_URL / DOTENV_CONFIG_PATH / ROLE ⇒ ném lỗi nêu tên khoá (kể cả sai hoa thường)", () => {
    for (const k of [...NAM_CO, "DATABASE_URL", "DOTENV_CONFIG_PATH", "ROLE"]) {
      expect(() => dung({ [k]: "true" }), k).toThrow(new RegExp(k));
      expect(() => dung({ [k.toLowerCase()]: "true" }), k.toLowerCase()).toThrow(new RegExp(k, "i"));
    }
    expect(() => dung({ robot_control_enabled: "true" })).toThrow(/robot_control_enabled/);
    expect([...KHOA_CAM_GHI_DE].sort()).toEqual([...NAM_CO, "DATABASE_URL", "DOTENV_CONFIG_PATH", "ROLE"].sort());
  });

  it("khoá thuộc ALWAYS_OFF: giá trị khác ⇒ ném (kể cả sai hoa thường); giá trị trùng ⇒ được", () => {
    expect(() => dung({ ROBOT_GATEWAY_ENABLED: "true" })).toThrow(/ROBOT_GATEWAY_ENABLED/);
    expect(() => dung({ robot_gateway_enabled: "true" })).toThrow(/robot_gateway_enabled/);
    expect(() => dung({ MQTT_ENABLED: "true" })).toThrow(/MQTT_ENABLED/);
    expect(() => dung({ UNS_BROKER_URL: "mqtt://10.0.0.1:1883" })).toThrow(/UNS_BROKER_URL/);
    expect(dung({ MQTT_ENABLED: "false" }).MQTT_ENABLED).toBe("false");
    expect(dung({ mqtt_enabled: "false" }).MQTT_ENABLED).toBe("false");
    // MỌI khoá của ALWAYS_OFF thật: đổi giá trị ⇒ ném
    for (const [k, v] of Object.entries(docAlwaysOff() as Record<string, string>)) expect(() => dung({ [k]: v + "-khac" }), k).toThrow(new RegExp(k));
  });

  it("NODE_OPTIONS (mọi giá trị) ⇒ ném; PORT / BIEN_MOI vẫn được", () => {
    expect(() => dung({ NODE_OPTIONS: "--x" })).toThrow(/NODE_OPTIONS/);
    expect(() => dung({ node_options: "" })).toThrow(/node_options/);
    expect(KHOA_CAM_MOI_GIA_TRI).toEqual(["NODE_OPTIONS"]);
    const env = dung({ PORT: "3017", BIEN_MOI: "co" });
    expect(env.PORT).toBe("3017");
    expect(env.BIEN_MOI).toBe("co");
  });

  it("danh sách biến hệ điều hành được giữ = danh sách VIẾT CỨNG (không thêm NODE_OPTIONS hay biến cấu hình nào)", () => {
    expect([...BIEN_HE_DIEU_HANH]).toEqual(["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"]);
    const env = dungEnvCoLap({ NODE_OPTIONS: "--require x", PATH: "p" }, { port: 1, dbUrl: "postgres://x/aoi_management_test", logDir: ".b", ghiDe: {} });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBe("p");
  });

  it("khoá env con ⊆ (keep ∪ cấu hình đo ∪ ALWAYS_OFF ∪ năm cờ) — không biến nào khác rò vào", () => {
    const cauHinh = ["DOTENV_CONFIG_PATH", "DATABASE_URL", "PORT", "ROLE", "JWT_SECRET", "LICENSE_BYPASS", "AUTH_2FA_BAT_BUOC", "VITE_APP_ID", "GGUF_WARM_DEEP_MODEL_ON_BOOT", "LLAMA_SERVER_ENABLED", "LLAMA_WATCHDOG_ENABLED", "AI_ORCHESTRATION_ENABLED", "AI_KB_WARM_ON_BOOT", "VITEST"];
    const cho = new Set<string>([...BIEN_HE_DIEU_HANH, ...cauHinh, ...Object.keys(docAlwaysOff()), ...NAM_CO]);
    const la = Object.keys(dung()).filter((k) => !cho.has(k));
    expect(la).toEqual([]);
  });

  it("docAlwaysOff: đọc nguồn thật ra ≥ 10 cờ và ROBOT_CONTROL_ENABLED=false; nguồn hỏng ⇒ ném lỗi", () => {
    const o = docAlwaysOff();
    expect(Object.keys(o).length).toBeGreaterThanOrEqual(10);
    expect(o.ROBOT_CONTROL_ENABLED).toBe("false");
    expect(o.UNS_BROKER_URL).toBe("mqtt://127.0.0.1:9");
    expect(() => docAlwaysOff("export const khac = {};")).toThrow(/ALWAYS_OFF/);
    expect(() => docAlwaysOff('export const ALWAYS_OFF: Record<string, string> = {\n  A_B: "false",\n};')).toThrow(/không hợp lệ/);
    // ≥ 10 khoá nhưng ROBOT_CONTROL_ENABLED=true ⇒ ném
    const muoiKhoa = Array.from({ length: 12 }, (_, i) => `K${i}: "false"`).join(", ");
    expect(() => docAlwaysOff(`export const ALWAYS_OFF: Record<string, string> = {\n  ${muoiKhoa}, ROBOT_CONTROL_ENABLED: "true",\n};`)).toThrow(/không hợp lệ/);
    // ROBOT=false nhưng < 10 khoá ⇒ ném
    expect(() => docAlwaysOff('export const ALWAYS_OFF: Record<string, string> = {\n  ROBOT_CONTROL_ENABLED: "false", K1: "false",\n};')).toThrow(/không hợp lệ/);
    // ROBOT=false và ≥ 10 khoá ⇒ đạt
    expect(docAlwaysOff(`export const ALWAYS_OFF: Record<string, string> = {\n  ${muoiKhoa}, ROBOT_CONTROL_ENABLED: "false",\n};`).ROBOT_CONTROL_ENABLED).toBe("false");
  });

  it("nguồn boot-lap.mjs không còn ...process.env; so đường dẫn chạy bằng realpath và có cảnh báo stderr khi lệch", () => {
    const nguon = doc("scripts/chan-doan/boot-lap.mjs");
    expect(nguon).not.toMatch(/\.\.\.\s*process\.env/);
    expect(nguon).toContain("fs.realpathSync(process.argv[1])");
    expect(nguon).toMatch(/console\.error\(`boot-lap: KHÔNG chạy/);
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
        expect(sau, k).toMatch(new RegExp(`(^|[^A-Z0-9_])${k}: "false"`)); // tên đủ: AI_OT_CONTROL_ENABLED không được làm khớp nhầm OT_CONTROL_ENABLED
      }
    });
  }
});

describe("scripts/ui-metrics/engineeringLayout.mjs — FOE_DURABLE", () => {
  const nguon = doc("scripts/ui-metrics/engineeringLayout.mjs");

  it("ALWAYS_OFF có FOE_DURABLE=false, OT_CONTROL_ENABLED=false, ROBOT_CONTROL_ENABLED=false", () => {
    const m = /const ALWAYS_OFF = \{([\s\S]*?)\n\};/.exec(nguon);
    expect(m).not.toBeNull();
    // Khớp THEO TÊN ĐỦ (OT_CONTROL_ENABLED là đuôi của ROBOT_CONTROL_ENABLED nên toContain sẽ khớp nhầm).
    for (const k of ["FOE_DURABLE", "OT_GATEWAY_ENABLED", "OT_CONTROL_ENABLED", "ROBOT_CONTROL_ENABLED"]) expect(m![1], k).toMatch(new RegExp(`(^|[^A-Z0-9_])${k}: "false"`));
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
