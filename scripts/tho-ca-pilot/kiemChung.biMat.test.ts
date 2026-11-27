import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacDangBiMat, ENV_DB_CHET, envSachChoTienTrinhCon, giaTriBiMatTuUrl, taoChayLenhKiem, trichTenCaDo, xoaGiaTriBiMat } from "./kiemChung";

const MK = "Mk9xPz3Qw7Ab";
const MK_DB = "p@ss/w0rd!XyZ9";
/** mật khẩu có base64 chuẩn chứa + và / (để dạng url-safe KHÁC dạng chuẩn) */
const MK_B64 = "???>>>~~~!!!AbCd";

const dangTuyetDoi = (mk: string) => {
  const buf = Buffer.from(mk, "utf8");
  return {
    nguyen: mk,
    urlencoded: encodeURIComponent(mk),
    hex: buf.toString("hex"),
    hexHoa: buf.toString("hex").toUpperCase(),
    dao: mk.split("").reverse().join(""),
    b64: buf.toString("base64").replace(/=+$/, ""),
    b64UrlSafe: buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"),
  };
};

/** Đoạn base64 của mk khi mk đứng sau k byte tiền tố — chỉ những ký tự nằm HOÀN TOÀN trong byte của mk. */
const manhB64 = (mk: string, k: number, hau = "zz") => {
  const buf = Buffer.from(mk, "utf8");
  const tron = Buffer.concat([Buffer.from("A".repeat(k)), buf, Buffer.from(hau)]).toString("base64");
  return { tron, manh: tron.slice(Math.ceil((k * 8) / 6), Math.floor(((k + buf.length) * 8) / 6)) };
};

describe("giaTriBiMatTuUrl", () => {
  it("★★★ trả mật khẩu ĐÃ GIẢI MÃ; không mật khẩu / quá ngắn / URL rác ⇒ rỗng", () => {
    expect(giaTriBiMatTuUrl(`postgresql://avi_app:${encodeURIComponent(MK_DB)}@127.0.0.1:5434/aoi_management_test`)).toEqual([MK_DB]);
    expect(giaTriBiMatTuUrl("postgresql://avi_app@127.0.0.1:5434/db")).toEqual([]);
    expect(giaTriBiMatTuUrl("postgresql://u:x@127.0.0.1:9/db")).toEqual([]);
    expect(giaTriBiMatTuUrl("postgresql://u:12345@h/db")).toEqual([]); // < 6 ký tự: không lọc (sẽ xoá oan)
    expect(giaTriBiMatTuUrl("postgresql://u:123456@h/db")).toEqual(["123456"]);
    expect(giaTriBiMatTuUrl("khong-phai-url")).toEqual([]);
    expect(giaTriBiMatTuUrl(undefined)).toEqual([]);
  });
});

describe("xoaGiaTriBiMat — từng dạng mã hoá của mật khẩu", () => {
  for (const mk of [MK, MK_DB, MK_B64]) {
    const d = dangTuyetDoi(mk);
    it.each([
      ["nguyên dạng", d.nguyen],
      ["urlencoded", d.urlencoded],
      ["hex thường", d.hex],
      ["hex HOA", d.hexHoa],
      ["đảo ngược", d.dao],
      ["base64 đứng một mình", d.b64],
      ["base64 url-safe", d.b64UrlSafe],
      ["viết hoa toàn bộ", mk.toUpperCase()],
      ["viết thường toàn bộ", mk.toLowerCase()],
    ])(`★★★ [${mk}] %s ⇒ bị xoá`, (_t, dang) => {
      const ra = xoaGiaTriBiMat(`dòng trước ${dang} dòng sau`, [mk]);
      expect(ra).not.toContain(dang);
      expect(ra).toContain("***");
      expect(ra).toContain("dòng trước");
      expect(ra).toContain("dòng sau");
    });

    it.each([0, 1, 2])(`★★★ [${mk}] base64 CỦA CHUỖI LỚN HƠN, căn chỉnh %s byte ⇒ xoá ĐÚNG đoạn của mật khẩu (không thừa, không sót ký tự nào)`, (k) => {
      const { tron, manh } = manhB64(mk, k);
      expect(manh.length).toBeGreaterThanOrEqual(6);
      expect(tron).toContain(manh);
      const dau = Math.ceil((k * 8) / 6);
      const cuoi = Math.floor(((k + Buffer.byteLength(mk)) * 8) / 6);
      const ra = xoaGiaTriBiMat(`token=${tron}`, [mk]);
      expect(ra).toBe(`token=${tron.slice(0, dau)}***${tron.slice(cuoi)}`);
    });

    it.each([0, 1, 2])(`★★★ [${mk}] base64 URL-SAFE của chuỗi lớn hơn, căn chỉnh %s byte ⇒ xoá đúng đoạn`, (k) => {
      const { tron, manh } = manhB64(mk, k);
      const an = (x: string) => x.replace(/\+/g, "-").replace(/\//g, "_");
      const dau = Math.ceil((k * 8) / 6);
      const cuoi = Math.floor(((k + Buffer.byteLength(mk)) * 8) / 6);
      const ra = xoaGiaTriBiMat(`token=${an(tron)}`, [mk]);
      expect(ra).toBe(`token=${an(tron).slice(0, dau)}***${an(tron).slice(cuoi)}`);
      void manh;
    });

    it.each([
      ["cách nhau dấu cách", (x: string) => x.split("").join(" ")],
      ["cách nhau dấu phẩy", (x: string) => x.split("").join(",")],
      ["cách nhau gạch ngang", (x: string) => x.split("").join("-")],
      ["cách nhau hai ký tự", (x: string) => x.split("").join("..")],
      ["tách từng ký tự bằng xuống dòng", (x: string) => x.split("").join("\n")],
    ])(`★★★ [${mk}] tách ký tự: %s ⇒ bị xoá`, (_t, tach) => {
      const ra = xoaGiaTriBiMat(`x ${tach(mk)} y`, [mk]);
      expect(ra).toBe("x *** y");
    });

    it(`★★ [${mk}] tách ký tự VIẾT HOA / viết thường ⇒ vẫn bị xoá`, () => {
      expect(xoaGiaTriBiMat(`x ${mk.toUpperCase().split("").join(" ")} y`, [mk])).toBe("x *** y");
      expect(xoaGiaTriBiMat(`x ${mk.toLowerCase().split("").join(" ")} y`, [mk])).toBe("x *** y");
    });
  }

  it("★★ không có gì để lọc ⇒ giữ NGUYÊN VĂN (danh sách rỗng, hoặc giá trị < 6 ký tự)", () => {
    const mau = "RUN v2.1.9\n ✓ a.test.ts (3 tests)\nTests 3 passed (3)";
    expect(xoaGiaTriBiMat(mau, [])).toBe(mau);
    const coChuoiNgan = `${mau}
abc abc a b c`;
    expect(xoaGiaTriBiMat(coChuoiNgan, ["abc"])).toBe(coChuoiNgan); // < 6 ký tự: không lọc (xoá sẽ làm hỏng văn bản)
  });
  it("★★ văn bản KHÔNG chứa mật khẩu giữ nguyên (không cắt oan)", () => {
    const mau = "RUN v2.1.9 D:/SOURCES/_tho_ca_wt\n ✓ server/db/x.test.ts (23 tests) 6ms\n Tests 23 passed (23)";
    expect(xoaGiaTriBiMat(mau, [MK, MK_DB])).toBe(mau);
  });
  it("★★ nhiều mật khẩu / nhiều lần xuất hiện đều bị xoá", () => {
    const ra = xoaGiaTriBiMat(`a ${MK} b ${MK} c ${MK_DB}`, [MK, MK_DB]);
    expect(ra).not.toContain(MK);
    expect(ra).not.toContain(MK_DB);
  });
  it("★ cacDangBiMat: mọi dạng đủ dài (≥ 6) và không trùng lặp", () => {
    const { chuoi } = cacDangBiMat(MK);
    expect(new Set(chuoi).size).toBe(chuoi.length);
    expect(chuoi.every((x) => x.length >= 6)).toBe(true);
    expect(chuoi).toContain(MK);
  });
});

describe("trichTenCaDo", () => {
  const MAU = [
    " RUN  v2.1.9 D:/x",
    " ❯ a.test.ts (3 tests | 2 failed) 9ms",
    "   × nhóm > ca một 3ms",
    "     → expected 1 to be 2 (MAT_KHAU_TRONG_THONG_DIEP)",
    "   × nhóm > ca hai",
    " FAIL  a.test.ts > nhóm > ca một",
    "AssertionError: expected 1 to be 2",
    " FAIL  b.test.ts > khác > ca ba",
    "   ✓ nhóm > ca xanh 1ms",
  ].join("\n");
  it("★★★ lấy tên ca đỏ (dòng × và FAIL), bỏ thông điệp lỗi (→) và ca xanh, bỏ trùng, bỏ ms", () => {
    expect(trichTenCaDo(MAU)).toEqual(["nhóm > ca một", "nhóm > ca hai", "khác > ca ba"]);
  });
  it("★★ không có ca đỏ ⇒ rỗng", () => {
    expect(trichTenCaDo(" ✓ a.test.ts (3 tests) 4ms\n Tests 3 passed (3)")).toEqual([]);
  });
  it("★★ tối đa 40 tên; mỗi tên ≤ 200 ký tự", () => {
    const nhieu = Array.from({ length: 60 }, (_v, i) => `   × ca ${i}`).join("\n");
    expect(trichTenCaDo(nhieu)).toHaveLength(40);
    const dai = trichTenCaDo(`   × ${"x".repeat(500)}`);
    expect(dai[0]).toHaveLength(200);
  });
});

describe("đầu ra lệnh kiểm THẬT: mật khẩu bị xoá ở mọi dạng, kể cả tên ca đỏ", () => {
  it("★★★ tiến trình con in mật khẩu nguyên dạng, base64, hex, đảo, tách ký tự và đặt tên ca bằng mật khẩu ⇒ `duoi` và `tenCaDo` sạch", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcm-"));
    try {
      const url = `postgresql://avi_app:${encodeURIComponent(MK)}@127.0.0.1:5434/aoi_management_test`;
      const lenh =
        `node -e "var p=decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).password);` +
        `console.log('N=' + p);console.log('B=' + Buffer.from(p).toString('base64'));console.log('H=' + Buffer.from(p).toString('hex'));` +
        `console.log('R=' + p.split('').reverse().join(''));console.log('S=' + p.split('').join(' '));console.log('   × ten ca ' + p + ' 3ms')"`;
      const kq = await taoChayLenhKiem({ testDbUrl: url })(lenh, cwd, 60);
      expect(kq.exit).toBe(0);
      const d = dangTuyetDoi(MK);
      for (const dang of [d.nguyen, d.hex, d.dao, d.b64]) expect(kq.duoi, dang).not.toContain(dang);
      expect(kq.duoi).not.toContain("M k 9 x");
      expect(JSON.stringify(kq)).not.toContain(MK);
      expect(kq.tenCaDo).toEqual(["ten ca ***"]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);
});

describe("envSachChoTienTrinhCon — danh sách trắng: biến ứng dụng của người chạy không tới mã model viết", () => {
  const gia = (ten: string[]) => Object.fromEntries(ten.map((t) => [t, `GIA_${t}`])) as NodeJS.ProcessEnv;
  /** đúng các tên bộ chạy TỰ ĐẶT (viết tay) — env cha rỗng thì con chỉ có chừng này */
  const TU_DAT = [
    "CI", "DATABASE_URL", "DOTNET_CLI_TELEMETRY_OPTOUT", "DOTNET_NOLOGO", "DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "FOE_DURABLE", "FOE_ENABLED", "FORCE_COLOR", "NO_COLOR",
    "OT_CONTROL_ENABLED", "OT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "ROBOT_GATEWAY_ENABLED", "TEST_DATABASE_URL",
    "npm_config_audit", "npm_config_fund", "npm_config_offline", "npm_config_update_notifier",
  ].sort();
  it("★★★ E1 mọi biến ngoài danh sách đều VẮNG (đích CSDL, hàng đợi, thư, khoá, proxy, tuỳ chọn node)", () => {
    const la = [
      "DATABASE_READ_URL", "TSDB_URL", "MCP_CUC_BO_DB_MAT_KHAU", "DEMO_ADMIN_URL", "MCP_CUC_BO_DB_URL", "DB_URL", "PGPASSWORD", "PGSERVICEFILE", "PGHOST",
      "REDIS_URL", "NATS_URL", "UNS_BROKER_URL", "SMTP_PASS", "GIA_APP_KEY", "GIA_KHOA_PEM", "LLAMA_SERVER_URL", "LLAMA_SERVER_API_KEY_FILE",
      "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "HTTP_PROXY", "https_proxy", "NO_PROXY", "ALL_PROXY",
    ];
    expect(Object.keys(envSachChoTienTrinhCon(gia(la))).sort()).toEqual(TU_DAT);
  });
  it("★★★ E2 biến hệ điều hành / chuỗi công cụ CÒN, nguyên tên và nguyên giá trị (không phân biệt hoa thường)", () => {
    const can = ["Path", "PATHEXT", "SystemRoot", "SystemDrive", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "ProgramFiles", "ProgramFiles(x86)"];
    const r = envSachChoTienTrinhCon(gia(can));
    expect(Object.fromEntries(can.map((t) => [t, r[t]]))).toEqual(gia(can));
  });
  it("★★ E3 có testDbUrl ⇒ TEST_DATABASE_URL được đặt LẠI đúng URL đó; DATABASE_URL là cổng chết", () => {
    const r = envSachChoTienTrinhCon(gia(["DATABASE_URL", "TEST_DATABASE_URL"]), { testDbUrl: "GIA_URL_TEST" });
    expect([r.DATABASE_URL, r.TEST_DATABASE_URL]).toEqual([ENV_DB_CHET.DATABASE_URL, "GIA_URL_TEST"]);
  });
  it("★★★ E4 người chạy không ghi đè được biến bộ chạy tự đặt: cờ điều khiển luôn \"false\", hai URL là cổng chết", () => {
    const co = ["FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED", "OT_CONTROL_ENABLED", "ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED"];
    const r = envSachChoTienTrinhCon({ ...Object.fromEntries(co.map((t) => [t, "true"])), DATABASE_URL: "GIA_THAT", TEST_DATABASE_URL: "GIA_THAT" } as NodeJS.ProcessEnv);
    expect(co.map((t) => r[t])).toEqual(co.map(() => "false"));
    expect([r.DATABASE_URL, r.TEST_DATABASE_URL]).toEqual([ENV_DB_CHET.DATABASE_URL, ENV_DB_CHET.TEST_DATABASE_URL]);
  });
});
