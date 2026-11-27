/**
 * Bộ chạy TỪ CHỐI worktree có `.env` (mọi driver), từ chối env người chạy trỏ tệp env, và soi lại `.env` giữa lượt. Ca chỉ TẠO tệp 0 byte trong worktree TẠM dưới os.tmpdir() do chính ca dựng, xoá trong finally, không
 * bao giờ đọc; không chạm `.env` của repo hay của worktree thật (dưới vitest bộ chạy còn từ chối mọi worktree ngoài os.tmpdir()).
 * Driver LUÔN là hàm giả tiêm vào, `tenDriver` chỉ là nhãn. KHÔNG BAO GIỜ truyền chuỗi "cli" / "host" làm driver: ở mã chưa có chốt, chuỗi đó chạy driver thật.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, type Driver, type TenDriver } from "./chayMotViec";
import type { ChayKiem, KetQuaKiem, KetQuaTsc } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const TEP = "client/src/lib/a.test.ts";
const THE = `MÃ: TC-99
MỤC TIÊU: thử chốt tệp môi trường
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;

let goc: string;
let ra: string;
let wt: string;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcenv-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(wt, { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, "README.md"), "x\n");
  // như repo thật: tệp môi trường bị git bỏ qua, nên chốt "cây sạch" KHÔNG nhìn thấy nó (thiếu dòng này thì mã cũ cũng từ chối vì cây bẩn, ca không chứng minh gì)
  fs.writeFileSync(path.join(wt, ".gitignore"), ".env\n.env.example\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const chayKiemXanh: ChayKiem = async (lenh) => ({
  lenh,
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } },
});

const TSC_XANH: KetQuaTsc = { exit: 0, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 0 };

const lamDriver = () => {
  let n = 0;
  const drv: Driver = async () => {
    n += 1;
    fs.mkdirSync(path.dirname(path.join(wt, TEP)), { recursive: true });
    fs.writeFileSync(path.join(wt, TEP), 'import { it, expect } from "vitest";\nit("x", () => expect(1 + 1).toBe(2));\n');
    return { vong: 1, token: null, ghiChu: [], hetGio: false };
  };
  return { drv, dem: () => n };
};

const chay = (tenDriver: TenDriver, driver: Driver) =>
  chayMotViec({
    van: THE, wt, base: "HEAD", driver, tenDriver, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh,
    chayTsc: async () => TSC_XANH, envNguoiChay: {},
  });

/** Tạo tệp 0 byte tên `ten` trong worktree tạm, chạy `than`, xoá trong finally. Từ chối nếu đường không nằm trong os.tmpdir(). */
async function voiTepRong(ten: ".env" | ".env.example", than: () => Promise<void>) {
  const tep = path.join(wt, ten);
  const tuongDoi = path.relative(os.tmpdir(), tep);
  if (tuongDoi === "" || tuongDoi.startsWith("..") || path.isAbsolute(tuongDoi)) throw new Error("tệp của ca phải nằm trong os.tmpdir()");
  fs.writeFileSync(tep, "", { flag: "wx" });
  try {
    await than();
  } finally {
    fs.rmSync(tep, { force: true });
  }
}

async function kyVongTuChoi(tenDriver: TenDriver) {
  const { drv, dem } = lamDriver();
  await voiTepRong(".env", async () => {
    const r = await chay(tenDriver, drv);
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain(`worktree có tệp .env — từ chối: ${path.resolve(wt)}`);
    expect(dem()).toBe(0);
    expect(git(wt, "branch", "--list", "pilot/tho-ca-*")).toBe("");
  });
}

describe("chayMotViec — chốt từ chối worktree có tệp .env", () => {
  it("★★★ G1 driver cli: worktree có .env rỗng ⇒ tu-choi, driver không được gọi, không tạo nhánh", async () => {
    await kyVongTuChoi("cli");
  });
  it("★★★ G2 driver host: worktree có .env rỗng ⇒ tu-choi, driver không được gọi, không tạo nhánh", async () => {
    await kyVongTuChoi("host");
  });
  it("★★★ G3 không có .env (chỉ có .env.example rỗng) ⇒ đi tiếp: driver được gọi một lần, kết cục xong", async () => {
    const { drv, dem } = lamDriver();
    await voiTepRong(".env.example", async () => {
      const r = await chay("host", drv);
      expect(r).toMatchObject({ ok: true, ketCuc: "xong" });
      expect(dem()).toBe(1);
    });
  });
  it("★★★ G4 chốt đứng TRƯỚC bước cất: cây bẩn trên nhánh pilot + có .env ⇒ tu-choi, không commit cất, tệp bẩn còn nguyên", async () => {
    git(wt, "checkout", "-q", "-b", "pilot/tho-ca-TC-98");
    fs.writeFileSync(path.join(wt, "ket-qua-cu.txt"), "lượt trước\n");
    const dauTruoc = git(wt, "rev-parse", "HEAD");
    const { drv, dem } = lamDriver();
    await voiTepRong(".env", async () => {
      const r = await chay("host", drv);
      expect(r.ketCuc).toBe("tu-choi");
      expect(git(wt, "rev-parse", "HEAD")).toBe(dauTruoc);
      expect(git(wt, "status", "--porcelain")).toContain("ket-qua-cu.txt");
      expect(dem()).toBe(0);
    });
  });
});

describe("chayMotViec — env của người chạy trỏ tệp env ⇒ từ chối", () => {
  async function chayVoiEnv(tenDriver: TenDriver, envNguoiChay: NodeJS.ProcessEnv) {
    const { drv, dem } = lamDriver();
    const r = await chayMotViec({ van: THE, wt, base: "HEAD", driver: drv, tenDriver, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh, chayTsc: async () => TSC_XANH, envNguoiChay });
    return { r, dem };
  }
  async function kyVong(tenDriver: TenDriver, env: NodeJS.ProcessEnv, lyDo: string) {
    const { r, dem } = await chayVoiEnv(tenDriver, env);
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain(`ENV-TRO-TEP-ENV: ${lyDo}`);
    expect(r.loi).not.toContain("GIA_DUONG");
    expect(dem()).toBe(0);
  }
  it("★★★ H1 driver cli: DOTENV_CONFIG_PATH có giá trị ⇒ tu-choi, không in giá trị", async () => {
    await kyVong("cli", { DOTENV_CONFIG_PATH: "GIA_DUONG" }, "DOTENV_CONFIG_PATH đang đặt");
  });
  it("★★★ H2 driver host: dotenv_config_path viết thường ⇒ tu-choi", async () => {
    await kyVong("host", { dotenv_config_path: "GIA_DUONG" }, "DOTENV_CONFIG_PATH đang đặt");
  });
  it("★★★ H3 driver cli: NODE_OPTIONS chứa --env-file ⇒ tu-choi", async () => {
    await kyVong("cli", { NODE_OPTIONS: "--max-old-space-size=64 --env-file=GIA_DUONG" }, "NODE_OPTIONS chứa --env-file");
  });
  it("★★★ H4 driver host: NODE_OPTIONS chứa --env-file-if-exists ⇒ tu-choi", async () => {
    await kyVong("host", { Node_Options: "--env-file-if-exists=GIA_DUONG" }, "NODE_OPTIONS chứa --env-file");
  });
  it("★★ H5 đối chứng: NODE_OPTIONS thường và DOTENV_CONFIG_PATH rỗng ⇒ đi tiếp", async () => {
    const { r, dem } = await chayVoiEnv("host", { NODE_OPTIONS: "--max-old-space-size=64", DOTENV_CONFIG_PATH: "" });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong" });
    expect(dem()).toBe(1);
  });
});

describe("chayMotViec — .env xuất hiện GIỮA lượt ⇒ dừng với lý do có tên", () => {
  const LY = "ENV-XUAT-HIEN-GIUA-LUOT";
  /** tạo tệp 0 byte .env trong worktree tạm (cùng chốt đường như voiTepRong); ca gọi nó phải bọc donEnv trong finally */
  const taoEnvRong = () => {
    const tep = path.join(wt, ".env");
    const tuongDoi = path.relative(os.tmpdir(), tep);
    if (tuongDoi === "" || tuongDoi.startsWith("..") || path.isAbsolute(tuongDoi)) throw new Error("tệp của ca phải nằm trong os.tmpdir()");
    // gọi lại được: ở mã CHƯA có chốt, bước tạo chạy hai lần (vd tsc trong lượt sửa) — ca phải đỏ ở khẳng định, không phải vì EEXIST
    if (!fs.existsSync(tep)) fs.writeFileSync(tep, "", { flag: "wx" });
  };
  const donEnv = () => fs.rmSync(path.join(wt, ".env"), { force: true });
  const coTsconfig = () => {
    fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "tsconfig");
  };
  const coBan = (them: Partial<Parameters<typeof chayMotViec>[0]>) => ({ van: THE, wt, base: "HEAD", ra, choPhepKhoRieng: true, luat: "# l\n", tenDriver: "host" as const, envNguoiChay: {} as NodeJS.ProcessEnv, driver: lamDriver().drv, ...them });
  const lyDoCuoi = (r: { luuY?: string[] }) => (r.luuY ?? []).join("\n");

  it("★★★ G5 lệnh kiểm tạo .env ⇒ vi-pham có tên, tsc không chạy; lượt kế trên cùng worktree bị chốt đầu lượt từ chối", async () => {
    coTsconfig();
    const n = { kiem: 0, tsc: 0 };
    const kiem: ChayKiem = async (lenh, cay, han) => { n.kiem += 1; taoEnvRong(); return chayKiemXanh(lenh, cay, han); };
    try {
      const r = await chayMotViec(coBan({ chayKiem: kiem, chayTsc: async () => { n.tsc += 1; return TSC_XANH; } }));
      expect(r).toMatchObject({ ok: false, ketCuc: "vi-pham" });
      expect(lyDoCuoi(r)).toContain(`${LY} (phát hiện: sau lệnh kiểm)`);
      expect(n).toEqual({ kiem: 1, tsc: 0 });
      const sau = await chayMotViec(coBan({ chayKiem: kiem, chayTsc: async () => TSC_XANH }));
      expect(sau.ketCuc).toBe("tu-choi");
      expect(sau.loi).toContain("worktree có tệp .env — từ chối");
      expect(n.kiem).toBe(1);
    } finally {
      donEnv();
    }
  });
  it("★★★ G6 .env xuất hiện trong lượt model ⇒ lệnh kiểm KHÔNG được chạy; vi-pham có tên", async () => {
    const n = { kiem: 0, tsc: 0 };
    const goc = lamDriver().drv;
    const drv: Driver = async (v) => { const k = await goc(v); taoEnvRong(); return k; };
    try {
      const r = await chayMotViec(coBan({ driver: drv, chayKiem: async (l, c, h) => { n.kiem += 1; return chayKiemXanh(l, c, h); }, chayTsc: async () => TSC_XANH }));
      expect(r).toMatchObject({ ok: false, ketCuc: "vi-pham" });
      expect(lyDoCuoi(r)).toContain(`${LY} (phát hiện: trước lệnh kiểm)`);
      expect(n.kiem).toBe(0);
    } finally {
      donEnv();
    }
  });
  it("★★★ G7 tsc đỏ và .env xuất hiện lúc tsc, thẻ có LƯỢT SỬA TSC ⇒ KHÔNG mở lượt sửa", async () => {
    coTsconfig();
    let luotModel = 0;
    const goc = lamDriver().drv;
    const drv: Driver = async (v) => { luotModel += 1; const k = await goc(v); return { ...k, token: { cache: null, prompt: null, soLuotModel: 7 } }; };
    const do_: KetQuaTsc = { exit: 2, hetGio: false, giay: 1, loiTrongTep: [`${TEP}(1,1): error TS2304: Cannot find name 'x'.`], tongLoi: 1 };
    try {
      const r = await chayMotViec(coBan({ van: `${THE}\nLƯỢT SỬA TSC: 1\nTRẦN LƯỢT MODEL: 20\nTRẦN PHÚT: 20`, envTran: {} as NodeJS.ProcessEnv, driver: drv, chayKiem: chayKiemXanh, chayTsc: async () => { taoEnvRong(); return do_; } }));
      expect(luotModel).toBe(1);
      expect(r).toMatchObject({ ok: false, ketCuc: "vi-pham", coLuotSua: false });
      expect(lyDoCuoi(r)).toContain(`${LY} (phát hiện: trước lượt sửa)`);
    } finally {
      donEnv();
    }
  });
  it("★★★ G8 driver LUÔN được đưa lệnh kiểm đã soi (không cần chayKiem tiêm): .env có trong lượt ⇒ lệnh kiểm của driver bị chặn", async () => {
    const n = { kiem: 0, tsc: 0 };
    let nhan: KetQuaKiem | null = null;
    let coHam = false;
    const goc = lamDriver().drv;
    const drv: Driver = async (v) => {
      const k = await goc(v);
      taoEnvRong();
      coHam = typeof v.chayKiem === "function";
      if (v.chayKiem) nhan = await v.chayKiem(`npx vitest run ${TEP}`, wt, 60);
      return k;
    };
    try {
      await chayMotViec(coBan({ driver: drv, taoChayKiem: () => async (l, c, h) => { n.kiem += 1; return chayKiemXanh(l, c, h); }, chayTsc: async () => TSC_XANH }));
      expect(coHam).toBe(true);
      expect(nhan).toMatchObject({ exit: null, loi: LY });
      expect(n.kiem).toBe(0);
    } finally {
      donEnv();
    }
  });
  it("★★★ G9 không bước nào soi trước đó (lượt model chỉ tạo .env, không đổi tệp ⇒ không lệnh kiểm) ⇒ soi CUỐI lượt vẫn bắt, ghi đè khong-lam", async () => {
    const drv: Driver = async () => { taoEnvRong(); return { vong: 1, token: null, ghiChu: [], hetGio: false }; };
    try {
      const r = await chayMotViec(coBan({ driver: drv, chayKiem: chayKiemXanh, chayTsc: async () => TSC_XANH }));
      expect(r).toMatchObject({ ok: false, ketCuc: "vi-pham" });
      expect(lyDoCuoi(r)).toContain(`${LY} (phát hiện: cuối lượt)`);
      expect(lyDoCuoi(r)).toContain("kết cục trước đó: khong-lam");
    } finally {
      donEnv();
    }
  });
});
