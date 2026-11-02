/**
 * Pilot "Thợ Cả nhận việc" — BỘ CHẠY MỘT VIỆC.
 *
 *   npx tsx scripts/tho-ca-pilot/chayMotViec.ts --the <tep-the.txt> [--wt D:\SOURCES\_tho_ca_wt] [--base main]
 *        [--driver kho|cli] [--ra <thu-muc-ket-qua>] [--ghi-luot <thu-muc>]
 *
 * Việc làm (theo thứ tự): đọc thẻ → kiểm worktree (LIÊN KẾT, sạch, tên `_tho_ca*`) → `git checkout -B pilot/tho-ca-<mã> <base>` → chép luật dự án
 * (`AGENTS.md`, ẩn khỏi diff) → chạy driver có hạn giờ → thu diff (kể cả tệp mới) + dòng thêm/xoá + thời gian tường → đối chiếu "chỉ sửa tệp
 * được phép" + vùng cấm cứng + CRLF → ghi `<ra>/<mã>.diff` và IN ĐÚNG MỘT DÒNG JSON kết quả ra stdout (nhật ký đi stderr).
 *
 * KHÔNG BAO GIỜ: commit · đụng main/.env/:3000/DB · in mật khẩu · chạy LỆNH KIỂM (dieu-phoi chạy, không tin lời khai của model).
 *
 * DRIVER
 *  • kho — chạy khô, KHÔNG gọi model: ghi các tệp mà `--kho-ghi` (JSON {đường: nộiDung}) nêu. Dùng để thử bộ chạy / ca kiểm.
 *  • cli — `npm run ai:cli` CÓ NGƯỜI NGỒI (stdio kế thừa). CLI cố ý đòi một phím 'y' sống cho MỖI lượt ghi (`hoiTuoi`: "KHÔNG có cờ bỏ qua bước
 *          duyệt"); bộ chạy KHÔNG tự trả lời 'y' thay người. Danh tính: AVI_CLI_USER / AVI_CLI_PASSWORD của TIẾN TRÌNH CHA (tài khoản không admin).
 *          ⚠ CLI dùng `streamAnswer` (đường tri thức cũ), KHÔNG qua `goiModelMayChu` ⇒ không có AI_GHI_LUOT_DIR / cacheTokens; không nạp AGENTS.md
 *          (luật được ghép vào đầu `--lenh`).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docTheViec, kiemDiffTheoThe, quetChamDb, tepTestTrongLenh, type TheViec, type ViPhamDiff } from "./theViec";

export type TenDriver = "kho" | "cli" | "host";

export interface KetQuaDriver {
  /** vòng model đã chạy nếu driver biết; null = không biết */
  vong: number | null;
  /** token xử lý nếu có nguồn (bản ghi lượt); null = không đo được */
  token: { cache: number | null; prompt: number | null; soLuotModel: number } | null;
  /** nhật ký ngắn (đi stderr) */
  ghiChu: string[];
  /** thống kê cổng duyệt (driver host): giây chờ NGƯỜI tách khỏi thời gian model */
  duyet?: { soLanCho: number; soChapNhan: number; soTuChoi: number; giayChoDuyet: number };
  /** lý do dừng của lượt (hoan-thanh | het-luot | het-gio | loi-model | …) nếu driver biết */
  lyDoDung?: string;
  /** lưu ý driver muốn ghi vào JSON (vd khoá checkpoint tạm) */
  luuY?: string[];
  /** đếm lỗi công cụ theo mã (vd { "CHECKPOINT_LOI:KHONG_CO_KHOA": 4 }) */
  loiCongCu?: Record<string, number>;
}

export interface DauVaoDriver {
  the: TheViec;
  wt: string;
  /** luật dự án đã ghép sẵn + thẻ, dạng một lệnh */
  lenh: string;
  hanGiay: number;
  /** thư mục kết quả (hồ sơ chờ duyệt đặt ở đây) */
  ra: string;
  ghiLuotDir: string | null;
  khoGhi: Record<string, string>;
}
export type Driver = (v: DauVaoDriver) => Promise<KetQuaDriver & { hetGio: boolean; loi?: string }>;

export interface KetQuaViec {
  ma: string | null;
  ok: boolean;
  /** xong | het-gio | loi-driver | vi-pham | tu-choi */
  ketCuc: "xong" | "het-gio" | "loi-driver" | "vi-pham" | "tu-choi" | "khong-lam";
  loi?: string;
  nhanh?: string;
  baseSha?: string;
  driver?: TenDriver;
  giayTuong?: number;
  /** giayTuong trừ thời gian chờ người duyệt = thời gian của model + công cụ */
  giayModel?: number;
  /** lý do dừng của lượt agent (hoan-thanh | het-luot | loi-model | …) — driver host */
  lyDoDung?: string;
  soLanCho?: number;
  soChapNhan?: number;
  soTuChoi?: number;
  giayChoDuyet?: number;
  /** số lỗi công cụ theo mã — để thấy ngay từ JSON vì sao Thợ Cả không ghi được */
  loiCongCu?: Record<string, number>;
  vong?: number | null;
  token?: KetQuaDriver["token"];
  tepDoi?: string[];
  dong?: { them: number; xoa: number };
  viPham?: ViPhamDiff[];
  crlf?: string[];
  diff?: string;
  lenhKiem?: string;
  /** chưa đo được gì ở các trường trên null — nói rõ vì sao */
  luuY?: string[];
}

function git(args: string[], cwd: string, dauVao?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", input: dauVao, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const RE_NHANH_MA = /^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/;

/** Luật dự án nguồn sự thật (cạnh bộ chạy trong repo). */
export function duongTepLuat(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/tho-ca-pilot/luat-du-an.md");
}

export function ghepLenh(the: TheViec, luat: string): string {
  return [
    luat.trim(),
    "",
    "=== THẺ VIỆC ===",
    `MÃ: ${the.ma}`,
    `MỤC TIÊU: ${the.mucTieu}`,
    `TỆP ĐƯỢC PHÉP SỬA/TẠO: ${the.tepDuocPhep.join(", ")}`,
    the.nguCanhDoc.length ? `NGỮ CẢNH ĐỌC: ${the.nguCanhDoc.join(", ")}` : "",
    `LỆNH KIỂM: ${the.lenhKiem}`,
    `GIỚI HẠN: ${Math.round(the.gioiHan.giay / 60)} phút, ${the.gioiHan.vong} vòng`,
  ]
    .filter((x) => x !== "")
    .join("\n");
}

// ── Drivers ──────────────────────────────────────────────────────────────────────────────────────

export const driverKho: Driver = async (v) => {
  const ghiChu: string[] = [];
  for (const [rel, noiDung] of Object.entries(v.khoGhi)) {
    const dich = path.resolve(v.wt, rel);
    if (!dich.startsWith(path.resolve(v.wt) + path.sep)) {
      ghiChu.push(`kho: bỏ qua đường ra ngoài worktree: ${rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dich), { recursive: true });
    fs.writeFileSync(dich, noiDung, "utf8");
    ghiChu.push(`kho: ghi ${rel}`);
  }
  return { vong: Object.keys(v.khoGhi).length > 0 ? 1 : 0, token: null, ghiChu, hetGio: false };
};

export const driverCli: Driver = (v) =>
  new Promise((xong) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AI_REPO_SANDBOX_ROOTS: v.wt };
    if (v.ghiLuotDir) env.AI_GHI_LUOT_DIR = v.ghiLuotDir;
    const con = spawn("npx", ["tsx", "server/services/aiCodingCli/batDau.ts", "--du-an", path.basename(v.wt), "--lenh", v.lenh], {
      cwd: v.wt,
      env,
      stdio: "inherit",
      shell: true,
    });
    let hetGio = false;
    const dong = setTimeout(() => {
      hetGio = true;
      spawnSync("taskkill", ["/PID", String(con.pid), "/T", "/F"], { stdio: "ignore" });
    }, v.hanGiay * 1000);
    con.on("exit", (ma) =>
      xong({
        vong: null,
        token: null,
        ghiChu: [`cli: thoát mã ${ma}`],
        hetGio,
        ...(ma !== 0 && !hetGio ? { loi: `cli thoát mã ${ma}` } : {}),
      }),
    );
    con.on("error", (e) => xong({ vong: null, token: null, ghiChu: [], hetGio: false, loi: String(e) }));
    void dong;
  });

const DRIVERS: Record<Exclude<TenDriver, "host">, Driver> = { kho: driverKho, cli: driverCli };

// ── Thu diff ─────────────────────────────────────────────────────────────────────────────────────

const TEP_LUAT = "AGENTS.md";

function thuTepDoi(wt: string): string[] {
  const r = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], wt);
  const ra: string[] = [];
  const mucs = r.out.split("\0").filter((x) => x !== "");
  for (let i = 0; i < mucs.length; i++) {
    const m = mucs[i];
    const ma = m.slice(0, 2);
    const duong = m.slice(3);
    if (ma[0] === "R" || ma[0] === "C") i++; // mục kế tiếp là tên cũ
    if (duong !== TEP_LUAT) ra.push(duong);
  }
  return ra.sort();
}

function demDong(wt: string, tep: string[]): { them: number; xoa: number } {
  let them = 0;
  let xoa = 0;
  const r = git(["diff", "--numstat", "HEAD", "--", ...tep], wt);
  for (const dong of r.out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(dong);
    if (m) {
      them += m[1] === "-" ? 0 : Number(m[1]);
      xoa += m[2] === "-" ? 0 : Number(m[2]);
    }
  }
  return { them, xoa };
}

function tepCrlf(wt: string, tep: string[]): string[] {
  const ra: string[] = [];
  for (const t of tep) {
    try {
      const b = fs.readFileSync(path.join(wt, t));
      if (b.includes(Buffer.from("\r\n"))) ra.push(t);
    } catch {
      /* tệp bị xoá */
    }
  }
  return ra;
}

// ── Chạy một việc ─────────────────────────────────────────────────────────────────────────────────

export interface ThamSoViec {
  van: string;
  wt: string;
  base: string;
  driver: TenDriver | Driver;
  ra: string;
  ghiLuotDir?: string | null;
  khoGhi?: Record<string, string>;
  /** nhãn ghi vào JSON khi `driver` là hàm (vd "host") */
  tenDriver?: TenDriver;
  /** CHỈ cho ca kiểm: cho phép worktree không phải worktree LIÊN KẾT (kho tạm). Không có cờ CLI tương ứng. */
  choPhepKhoRieng?: boolean;
  luat?: string;
  nhatKy?: (s: string) => void;
}

export async function chayMotViec(p: ThamSoViec): Promise<KetQuaViec> {
  const nhatKy = p.nhatKy ?? (() => undefined);
  const tuChoi = (loi: string, ma: string | null = null): KetQuaViec => ({ ma, ok: false, ketCuc: "tu-choi", loi });
  const tenDriver: TenDriver = typeof p.driver === "string" ? p.driver : p.tenDriver ?? "kho";

  const dt = docTheViec(p.van);
  if (!dt.ok) return tuChoi(dt.loi);
  const the = dt.the;
  if (!RE_NHANH_MA.test(the.ma)) return tuChoi("mã thẻ không dùng được làm tên nhánh", the.ma);

  const wt = path.resolve(p.wt);
  if (!/^_tho_ca/i.test(path.basename(wt)) && !p.choPhepKhoRieng) return tuChoi(`worktree "${wt}" không phải thư mục _tho_ca* — từ chối để không sửa nhầm nơi khác`, the.ma);
  if (!fs.existsSync(wt)) return tuChoi(`worktree không tồn tại: ${wt}`, the.ma);
  const top = git(["rev-parse", "--show-toplevel"], wt);
  if (!top.ok || path.resolve(top.out.trim()) !== wt) return tuChoi("đường không phải gốc một worktree git", the.ma);
  const gitDir = git(["rev-parse", "--git-dir"], wt).out.trim();
  const chung = git(["rev-parse", "--git-common-dir"], wt).out.trim();
  const laLienKet = path.resolve(wt, gitDir) !== path.resolve(wt, chung);
  if (!laLienKet && !p.choPhepKhoRieng) return tuChoi("đây là worktree CHÍNH, không phải worktree liên kết — từ chối", the.ma);
  const ban = git(["status", "--porcelain=v1", "--untracked-files=all"], wt).out.split("\n").filter((x) => x !== "" && !x.endsWith(` ${TEP_LUAT}`));
  if (ban.length > 0) return tuChoi(`worktree không sạch (${ban.length} mục) — dọn trước khi nhận việc`, the.ma);

  // LỆNH KIỂM trỏ vào tệp test ĐÃ CÓ mà chạm DB ⇒ từ chối (luật: quét import/nội dung, không chỉ tên .db.test). Tệp chưa có (Thợ Cả sẽ tạo) kiểm sau khi chạy.
  for (const t of tepTestTrongLenh(the.lenhKiem)) {
    const f = path.join(wt, t);
    if (fs.existsSync(f)) {
      const dau = quetChamDb(t, fs.readFileSync(f, "utf8"));
      if (dau.length > 0) return tuChoi(`LỆNH KIỂM trỏ vào tệp chạm DB (${t}: ${dau.join(", ")}) — pilot không chạy test DB`, the.ma);
    } else if (quetChamDb(t, "").length > 0) {
      return tuChoi(`LỆNH KIỂM trỏ vào tệp .db.test (${t}) — pilot không chạy test DB`, the.ma);
    }
  }
  const base = git(["rev-parse", "--verify", `${p.base}^{commit}`], wt);
  if (!base.ok) return tuChoi(`không có base "${p.base}"`, the.ma);
  const baseSha = base.out.trim();
  const nhanh = `pilot/tho-ca-${the.ma}`;
  const cb = git(["checkout", "-q", "-B", nhanh, baseSha], wt);
  if (!cb.ok) return tuChoi(`không tạo được nhánh ${nhanh}: ${cb.err.trim()}`, the.ma);

  // luật dự án → AGENTS.md ở gốc worktree, ẩn khỏi git (info/exclude) để không lẫn vào diff
  const luat = p.luat ?? fs.readFileSync(duongTepLuat(), "utf8");
  fs.writeFileSync(path.join(wt, TEP_LUAT), luat, "utf8");
  const ex = git(["rev-parse", "--git-path", "info/exclude"], wt).out.trim();
  const exPath = path.resolve(wt, ex);
  try {
    fs.mkdirSync(path.dirname(exPath), { recursive: true });
    const cu = fs.existsSync(exPath) ? fs.readFileSync(exPath, "utf8") : "";
    if (!cu.split("\n").includes(TEP_LUAT)) fs.appendFileSync(exPath, `${cu.endsWith("\n") || cu === "" ? "" : "\n"}${TEP_LUAT}\n`);
  } catch {
    /* nếu không ghi được exclude, thuTepDoi vẫn bỏ AGENTS.md ra khỏi danh sách */
  }

  if (p.driver === "host") return tuChoi("driver host phải được dựng ở dòng lệnh (phuThuocHostThat) rồi truyền vào dạng hàm", the.ma);
  const driver = typeof p.driver === "string" ? DRIVERS[p.driver] : p.driver;
  const t0 = Date.now();
  nhatKy(`bắt đầu ${the.ma} trên ${nhanh} @ ${baseSha.slice(0, 9)} (driver ${tenDriver}, hạn ${the.gioiHan.giay}s)`);
  const kq = await driver({ the, wt, lenh: ghepLenh(the, luat), hanGiay: the.gioiHan.giay, ra: p.ra, ghiLuotDir: p.ghiLuotDir ?? null, khoGhi: p.khoGhi ?? {} });
  const giayTuong = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
  for (const g of kq.ghiChu) nhatKy(g);

  // thu diff: đánh dấu tệp mới là "ý định thêm" để `git diff` thấy; chỉ chạm index của worktree pilot, không commit
  const tepDoi = thuTepDoi(wt);
  if (tepDoi.length > 0) git(["add", "-N", "--", ...tepDoi], wt);
  const dong = tepDoi.length ? demDong(wt, tepDoi) : { them: 0, xoa: 0 };
  const diffText = tepDoi.length ? git(["diff", "HEAD", "--", ...tepDoi], wt).out : "";
  fs.mkdirSync(p.ra, { recursive: true });
  const diffPath = path.join(p.ra, `${the.ma}.diff`);
  fs.writeFileSync(diffPath, diffText, "utf8");

  const viPham = kiemDiffTheoThe(tepDoi, the.tepDuocPhep);
  // tệp test do Thợ Cả viết/sửa mà chạm DB ⇒ vi phạm (dieu-phoi KHÔNG được chạy nó)
  for (const t of tepDoi) {
    if (!/\.test\.[cm]?[jt]sx?$/.test(t)) continue;
    try {
      const dau = quetChamDb(t, fs.readFileSync(path.join(wt, t), "utf8"));
      if (dau.length > 0) viPham.push({ duong: t, loai: "cham-db", chiTiet: dau.join(", ") });
    } catch {
      /* tệp bị xoá */
    }
  }
  const crlf = tepCrlf(wt, tepDoi);
  const luuY: string[] = [...(kq.luuY ?? [])];
  if (kq.token === null) luuY.push("token xử lý: driver không có nguồn đo (CLI không qua goiModelMayChu); do-model đo ở llama-server nếu cần");
  if (kq.vong === null) luuY.push("số vòng: driver không biết");

  // KHÔNG BAO GIỜ "xong" khi không làm gì: lượt lỗi ⇒ loi-driver; không đổi tệp nào và không lỗi ⇒ khong-lam (ok:false)
  let ketCuc: KetQuaViec["ketCuc"] = "xong";
  if (kq.hetGio) ketCuc = "het-gio";
  else if (kq.loi) ketCuc = "loi-driver";
  else if (tepDoi.length === 0) ketCuc = "khong-lam";
  if (viPham.length > 0 || crlf.length > 0) ketCuc = "vi-pham";

  return {
    ma: the.ma,
    ok: ketCuc === "xong",
    ketCuc,
    ...(kq.loi ? { loi: kq.loi } : {}),
    nhanh,
    baseSha,
    driver: tenDriver,
    giayTuong,
    giayModel: Math.round((giayTuong - (kq.duyet?.giayChoDuyet ?? 0)) * 10) / 10,
    ...(kq.duyet ? { soLanCho: kq.duyet.soLanCho, soChapNhan: kq.duyet.soChapNhan, soTuChoi: kq.duyet.soTuChoi, giayChoDuyet: kq.duyet.giayChoDuyet } : {}),
    ...(kq.lyDoDung ? { lyDoDung: kq.lyDoDung } : {}),
    ...(kq.loiCongCu ? { loiCongCu: kq.loiCongCu } : {}),
    vong: kq.vong,
    token: kq.token,
    tepDoi,
    dong,
    viPham,
    crlf,
    diff: diffPath,
    lenhKiem: the.lenhKiem,
    luuY,
  };
}

// ── Dòng lệnh ────────────────────────────────────────────────────────────────────────────────────

function docThamSo(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  }
  return o;
}

async function main(): Promise<number> {
  const a = docThamSo(process.argv.slice(2));
  if (!a.the) {
    process.stderr.write("dùng: chayMotViec.ts --the <tep-the> [--wt D:\\SOURCES\\_tho_ca_wt] [--base main] [--driver kho|cli] [--ra <thu-muc>] [--ghi-luot <thu-muc>] [--kho-ghi '<json>']\n");
    return 2;
  }
  const drv = (a.driver ?? "cli") as TenDriver;
  if (drv !== "kho" && drv !== "cli" && drv !== "host") {
    process.stderr.write(`driver không hợp lệ: ${drv}\n`);
    return 2;
  }
  let driver: TenDriver | Driver = drv;
  if (drv === "host") {
    if (a["env-tu"]) {
      const { napEnvTuTep } = await import("./napEnv");
      const kqNap = napEnvTuTep(a["env-tu"]);
      process.stderr.write(`[tho-ca-pilot] đã nạp từ --env-tu (chỉ tên khoá): ${kqNap.daNap.join(" ") || "(không)"}; đã có sẵn trong môi trường (giữ nguyên): ${kqNap.daCo.join(" ") || "(không)"}
`);
    }
    const id = Number(a["nguoi-id"]);
    if (!Number.isInteger(id) || id <= 0) {
      process.stderr.write("driver host cần --nguoi-id <id engineer1 trong _test> (KHÔNG admin) [--nguoi-vai engineer] [--han-duyet <giây>]\n");
      return 2;
    }
    if ((a["nguoi-vai"] ?? "engineer") === "admin") {
      process.stderr.write("từ chối: pilot KHÔNG chạy bằng vai admin\n");
      return 2;
    }
    const { driverHost, phuThuocHostThat } = await import("./driverHost");
    const dep = await phuThuocHostThat({ nguoi: { id, role: a["nguoi-vai"] ?? "engineer", name: "pilot-tho-ca" } });
    driver = driverHost(dep, a["han-duyet"] ? Number(a["han-duyet"]) : 3600);
  }
  const kq = await chayMotViec({
    van: fs.readFileSync(a.the, "utf8"),
    wt: a.wt ?? "D:\\SOURCES\\_tho_ca_wt",
    base: a.base ?? "main",
    driver,
    tenDriver: drv,
    ra: a.ra ?? path.join(os.tmpdir(), "tho-ca-pilot"),
    ghiLuotDir: a["ghi-luot"] ?? null,
    khoGhi: a["kho-ghi"] ? (JSON.parse(a["kho-ghi"]) as Record<string, string>) : {},
    nhatKy: (s) => process.stderr.write(`[tho-ca-pilot] ${s}\n`),
  });
  process.stdout.write(`${JSON.stringify(kq)}\n`);
  return kq.ok ? 0 : 1;
}

if (process.argv[1] && /chayMotViec\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (ma) => process.exit(ma),
    (e) => {
      process.stderr.write(`✖ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
      process.exit(3);
    },
  );
}
