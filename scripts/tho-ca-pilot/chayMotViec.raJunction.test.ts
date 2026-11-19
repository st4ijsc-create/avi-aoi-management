/**
 * P3-a / P3-b — kiểm `--ra` của `--cho-phep-db`:
 *  (a) so sánh tiền tố KHÔNG phân biệt hoa/thường, biên bằng dấu phân cách;
 *  (b) junction / liên kết: `--ra` đi qua liên kết trỏ vào worktree hoặc gốc sandbox ⇒ từ chối (so cả đường THẬT), không tạo thư mục;
 *  (c) có cờ mà thiếu `--ra` ⇒ từ chối (không còn mặc định %TEMP%).
 * Dùng junction THẬT (fs.symlinkSync kiểu "junction").
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { duongThat, raTrongGocSandbox } from "./chayMotViec";

const CHUOI = "--cho-phep-db: thư mục kết quả (--ra) nằm trong gốc sandbox / worktree — đặt ngoài để model không đọc được đầu ra đầy đủ của lệnh kiểm";
const CHUOI_THIEU = "--cho-phep-db: bắt buộc --ra tường minh (thư mục kết quả ngoài gốc sandbox và worktree); không dùng mặc định %TEMP%";
const env = (roots: string) => ({ AI_REPO_SANDBOX_ROOTS: roots }) as NodeJS.ProcessEnv;
const J = (...x: string[]) => path.join(...x);

let thu = "";
let wt = "";
let ngoai = "";
let sandbox = "";
let lkVaoWt = "";
let lkVaoSandbox = "";
let lkRaNgoai = "";

beforeAll(() => {
  thu = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), "tcjn-")));
  wt = J(thu, "wt");
  ngoai = J(thu, "ngoai");
  sandbox = J(thu, "sandbox");
  for (const d of [wt, ngoai, sandbox]) fs.mkdirSync(d);
  lkVaoWt = J(thu, "lk-vao-wt");
  lkVaoSandbox = J(thu, "lk-vao-sandbox");
  lkRaNgoai = J(thu, "lk-ra-ngoai");
  fs.symlinkSync(wt, lkVaoWt, "junction");
  fs.symlinkSync(sandbox, lkVaoSandbox, "junction");
  fs.symlinkSync(ngoai, lkRaNgoai, "junction");
});
afterAll(() => {
  // gỡ liên kết trước (rmSync recursive không đi theo junction, nhưng gỡ tường minh cho chắc)
  for (const l of [lkVaoWt, lkVaoSandbox, lkRaNgoai]) {
    try {
      fs.unlinkSync(l);
    } catch {
      try {
        fs.rmdirSync(l);
      } catch {
        /* bỏ qua */
      }
    }
  }
  fs.rmSync(thu, { recursive: true, force: true });
});

describe("P3-a — so tiền tố không phân biệt hoa/thường, biên bằng dấu phân cách", () => {
  it("★★★ --ra viết HOA/thường khác worktree ⇒ vẫn từ chối (so tường minh, không nhờ path.relative)", () => {
    const doiHoa = wt.replace(/[a-z]/g, (c) => c.toUpperCase());
    expect(doiHoa).not.toBe(wt);
    expect(raTrongGocSandbox(J(doiHoa, "ra"), wt, env(""))).toBe(CHUOI);
    expect(raTrongGocSandbox(J(wt, "RA", "SAU"), wt.toLowerCase(), env(""))).toBe(CHUOI);
  });
  it("★★★ gốc sandbox viết khác hoa/thường với --ra ⇒ từ chối", () => {
    expect(raTrongGocSandbox(J(sandbox.toUpperCase(), "ra"), wt, env(`k=${sandbox}`))).toBe(CHUOI);
  });
  it("★★ anh em cùng tiền tố (wt2 vs wt) ⇒ được (biên là dấu phân cách)", () => {
    expect(raTrongGocSandbox(`${wt}2`, wt, env(""))).toBeNull();
    expect(raTrongGocSandbox(J(`${wt}2`, "ra"), wt, env(""))).toBeNull();
  });
  it("★★ --ra là thư mục CHA của worktree ⇒ được; đúng bằng worktree ⇒ từ chối", () => {
    expect(raTrongGocSandbox(thu, wt, env(""))).toBeNull();
    expect(raTrongGocSandbox(wt, wt, env(""))).toBe(CHUOI);
  });
});

describe("P3-b — junction / liên kết", () => {
  it("★★★ duongThat: giải liên kết ở tổ tiên tồn tại, giữ đuôi chưa tồn tại, KHÔNG tạo gì", () => {
    const x = J(lkVaoWt, "chua", "co");
    expect(duongThat(x).toLowerCase()).toBe(J(wt, "chua", "co").toLowerCase());
    expect(fs.existsSync(J(wt, "chua"))).toBe(false);
  });
  it("★★★ --ra = liên kết trỏ vào worktree (chính liên kết) ⇒ từ chối", () => {
    expect(raTrongGocSandbox(lkVaoWt, J(thu, "wt"), env(""))).toBe(CHUOI);
  });
  it("★★★ --ra nằm DƯỚI liên kết trỏ vào worktree, thư mục ra chưa tồn tại ⇒ từ chối, không tạo", () => {
    const ra = J(lkVaoWt, "ket-qua", "luot1");
    expect(raTrongGocSandbox(ra, wt, env(""))).toBe(CHUOI);
    expect(fs.existsSync(J(wt, "ket-qua"))).toBe(false);
  });
  it("★★★ --ra dưới liên kết trỏ vào GỐC SANDBOX (khai bằng env) ⇒ từ chối", () => {
    expect(raTrongGocSandbox(J(lkVaoSandbox, "ra"), wt, env(`k=${sandbox}`))).toBe(CHUOI);
  });
  it("★★★ gốc sandbox khai bằng đường LIÊN KẾT, --ra dùng đường thật ⇒ từ chối", () => {
    expect(raTrongGocSandbox(J(sandbox, "ra"), wt, env(`k=${lkVaoSandbox}`))).toBe(CHUOI);
  });
  it("★★★ worktree khai bằng đường LIÊN KẾT, --ra dùng đường thật ⇒ từ chối", () => {
    expect(raTrongGocSandbox(J(wt, "ra"), lkVaoWt, env(""))).toBe(CHUOI);
  });
  it("★★ liên kết trỏ RA NGOÀI ⇒ được (không từ chối oan)", () => {
    expect(raTrongGocSandbox(J(lkRaNgoai, "ra"), wt, env(`k=${sandbox}`))).toBeNull();
    expect(raTrongGocSandbox(J(ngoai, "ra"), wt, env(`k=${sandbox}`))).toBeNull();
  });
  it("★★ đường không tồn tại, không liên kết, ngoài ⇒ được và không tạo gì", () => {
    const ra = J(thu, "khong", "ton", "tai");
    expect(raTrongGocSandbox(ra, wt, env(""))).toBeNull();
    expect(fs.existsSync(J(thu, "khong"))).toBe(false);
  });
});

describe("P3 — ghim thêm (đột biến sống p2/p4/p9 của kiem-dinh)", () => {
  it("★★★ junction đặt TRONG worktree trỏ RA NGOÀI: --ra qua nó vẫn bị từ chối (dạng chuỗi nằm trong worktree), cả khi đích thật nằm ngoài", () => {
    const lk = J(wt, "lk-trong-wt-ra-ngoai");
    fs.symlinkSync(ngoai, lk, "junction");
    try {
      expect(raTrongGocSandbox(lk, wt, env(""))).toBe(CHUOI);
      expect(raTrongGocSandbox(J(lk, "ra", "sau"), wt, env(""))).toBe(CHUOI);
      expect(raTrongGocSandbox(J(lk, "ra"), wt, env(`k=${sandbox}`))).toBe(CHUOI);
      // đối chứng: chính đích thật (ngoài) thì được
      expect(raTrongGocSandbox(J(ngoai, "ra"), wt, env(""))).toBeNull();
    } finally {
      fs.unlinkSync(lk);
    }
  });
  it.skipIf(process.platform !== "win32")("★★★ gốc sandbox LÀ GỐC Ổ ĐĨA (C:\): --ra bên trong nó bị từ chối; chính gốc ổ cũng bị từ chối (biên path.sep, không thành 'C:\\')", () => {
    const goc = path.parse(thu).root;
    expect(goc).toMatch(/^[A-Za-z]:\\$/);
    expect(raTrongGocSandbox(J(thu, "ra"), wt, env(`k=${goc}`))).toBe(CHUOI);
    expect(raTrongGocSandbox(goc, wt, env(`k=${goc}`))).toBe(CHUOI);
    expect(raTrongGocSandbox(J(goc, "bat-ky", "ra"), wt, env(`k=${goc.toLowerCase()}`))).toBe(CHUOI); // hoa/thường ổ đĩa
  });
  it("★★ gốc sandbox thường (không phải gốc ổ) vẫn không nuốt anh em cùng tiền tố", () => {
    expect(raTrongGocSandbox(`${sandbox}2`, wt, env(`k=${sandbox}`))).toBeNull();
  });
});

describe("P3-b — dòng lệnh thật: thiếu --ra khi có cờ", () => {
  it("★★★ có --cho-phep-db mà KHÔNG --ra ⇒ thoát mã 2, chuỗi cố định, không tạo %TEMP%\\tho-ca-pilot", () => {
    const tepUrl = J(thu, "tho_ca_test.url");
    fs.writeFileSync(tepUrl, "postgresql://tho_ca_test:abcdef123456@127.0.0.1:5434/aoi_management_test");
    const macDinh = J(os.tmpdir(), "tho-ca-pilot");
    const truoc = fs.existsSync(macDinh);
    const r = spawnSync("npx", ["tsx", "scripts/tho-ca-pilot/chayMotViec.ts", "--the", J(thu, "khong-co-the.txt"), "--cho-phep-db", "--tep-url-csdl", tepUrl, "--wt", wt], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true,
      timeout: 120_000,
      env: { ...process.env, AI_REPO_SANDBOX_ROOTS: "" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(CHUOI_THIEU);
    expect(r.stderr).not.toContain("abcdef123456");
    expect(fs.existsSync(macDinh)).toBe(truoc);
  }, 130_000);
});
