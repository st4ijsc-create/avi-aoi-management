/**
 * Đợt 12 · H5.3 — KHO ĐẦU RA DÀI: thư mục thật dưới một gốc tmp riêng của lưới. Khẳng định về byte trên đĩa, vị trí, quyền, trần, dọn, khoá theo lượt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IM_NHIP_TOI_DA_MS,
  TRAN_BYTE_MOI_LUOT,
  TRAN_BYTE_MOT_TEP,
  TRAN_BYTE_TONG_KHO,
  TRAN_DONG_GREP,
  TRAN_KY_TU_DOC,
  TRAN_TEP_MOI_LUOT,
  TTL_MS,
  dauRaDaiBat,
  taoKhoDauRaDai,
  type KhoDauRaDai,
} from "./khoDauRaDai";

let TMP = "";
let DU_AN = "";
const kho: KhoDauRaDai[] = [];
const tao = (dep: Parameters<typeof taoKhoDauRaDai>[0] = {}) => {
  const k = taoKhoDauRaDai({ tmp: TMP, gocDuAn: DU_AN, khongNhip: true, ...dep });
  kho.push(k);
  return k;
};
const KHOA_GIA = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";

beforeEach(() => {
  TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kho-dai-")));
  DU_AN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kho-dai-duan-")));
});
afterEach(() => {
  for (const k of kho.splice(0)) k.dongKho();
  for (const d of [TMP, DU_AN]) fs.rmSync(d, { recursive: true, force: true });
});

describe("công tắc", () => {
  it("chỉ '1' bật", () => {
    expect(dauRaDaiBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "on"]) expect(dauRaDaiBat(v)).toBe(false);
  });
});

describe("vị trí & tệp", () => {
  it("★★★ thư mục nằm DƯỚI tmp của tiến trình, NGOÀI gốc dự án; tệp tên ngẫu nhiên .txt, ĐÚNG nội dung; mã dạng out-<8 hex>", () => {
    const k = tao();
    const ma = k.luu({ runId: "r1", ten: "grep", noiDung: "hello\nworld" });
    expect(ma).toMatch(/^out-[0-9a-f]{8}$/);
    const dir = k.thuMuc()!;
    expect(path.relative(TMP, dir).startsWith("..")).toBe(false);
    expect(path.relative(DU_AN, dir).startsWith("..")).toBe(true);
    expect(path.basename(path.dirname(dir))).toBe("thoca-dau-ra");
    expect(path.basename(dir)).toMatch(/^p\d+-\d+-[0-9a-f]{8}$/);
    const tep = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
    expect(tep).toHaveLength(1);
    expect(tep[0]).toMatch(/^[0-9a-f]{32}\.txt$/);
    expect(fs.readFileSync(path.join(dir, tep[0]!), "utf8")).toBe("hello\nworld");
  });

  it("★ thư mục mặc định (không tiêm tmp) nằm dưới os.tmpdir() của tiến trình", () => {
    const k = taoKhoDauRaDai({ gocDuAn: DU_AN, khongNhip: true });
    kho.push(k);
    expect(k.luu({ runId: "r", ten: "t", noiDung: "x" })).not.toBeNull();
    const tmpThat = fs.realpathSync(os.tmpdir());
    expect(path.relative(tmpThat, fs.realpathSync(k.thuMuc()!)).startsWith("..")).toBe(false);
  });

  it("★★★ kho CHỒNG gốc dự án (gốc dự án là cha / con của kho) ⇒ không hợp lệ, KHÔNG lưu", () => {
    const k = taoKhoDauRaDai({ tmp: TMP, gocDuAn: TMP, khongNhip: true }); // gốc dự án = chính tmp chứa kho
    kho.push(k);
    expect(k.luu({ runId: "r", ten: "t", noiDung: "x" })).toBeNull();
    expect(k.hopLeVoiGoc(TMP)).toBe(false);
    const k2 = tao();
    expect(k2.hopLeVoiGoc(DU_AN)).toBe(true);
    expect(k2.hopLeVoiGoc(k2.thuMuc()!)).toBe(false);
    expect(k2.hopLeVoiGoc(path.dirname(k2.thuMuc()!))).toBe(false);
  });

  it("★★★ mở cờ 'wx': hai lần lưu KHÔNG ghi đè tệp nào; mỗi lần một tệp mới", () => {
    const k = tao();
    const a = k.luu({ runId: "r", ten: "t", noiDung: "AAA" })!;
    const b = k.luu({ runId: "r", ten: "t", noiDung: "BBB" })!;
    expect(a).not.toBe(b);
    const noiDung = fs.readdirSync(k.thuMuc()!).filter((f) => f.endsWith(".txt")).map((f) => fs.readFileSync(path.join(k.thuMuc()!, f), "utf8")).sort();
    expect(noiDung).toEqual(["AAA", "BBB"]);
  });

  it("★★★ mở tệp bằng cờ 'wx' và mode 0o600 (không ghi đè, quyền hẹp trên POSIX)", () => {
    const goc = fs.openSync;
    const goi: Array<{ cờ: unknown; mode: unknown; tep: string }> = [];
    (fs as { openSync: unknown }).openSync = ((p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) => {
      if (String(p).endsWith(".txt")) goi.push({ cờ: flags, mode, tep: String(p) });
      return goc(p, flags, mode);
    }) as typeof fs.openSync;
    try {
      const k = tao();
      k.luu({ runId: "r", ten: "t", noiDung: "x" });
    } finally {
      (fs as { openSync: unknown }).openSync = goc;
    }
    expect(goi).toHaveLength(1);
    expect(goi[0]).toMatchObject({ cờ: "wx", mode: 0o600 });
  });

  it.skipIf(process.platform === "win32")("quyền 0o600 cho tệp và 0o700 cho thư mục (POSIX; Windows dùng ACL của thư mục temp tài khoản)", () => {
    const k = tao();
    k.luu({ runId: "r", ten: "t", noiDung: "x" });
    const dir = k.thuMuc()!;
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const tep = fs.readdirSync(dir).find((f) => f.endsWith(".txt"))!;
    expect(fs.statSync(path.join(dir, tep)).mode & 0o777).toBe(0o600);
  });
});

describe("che bí mật", () => {
  it("★★★ bí mật lọt qua bộ làm sạch phía trên KHÔNG bao giờ nằm trong tệp (lớp thứ hai)", () => {
    const k = tao();
    const ma = k.luu({ runId: "r", ten: "run_command", noiDung: `build ok\napi key: ${KHOA_GIA}\nend` })!;
    const dir = k.thuMuc()!;
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain(KHOA_GIA);
    const r = k.doc("r", ma, {});
    expect(r.ok && r.text).toBeTruthy();
    expect(r.ok && r.text).not.toContain(KHOA_GIA);
    expect(r.ok && r.text).toContain("build ok");
  });
});

describe("đọc: theo dòng, grep, khoá theo lượt", () => {
  const nhieuDong = Array.from({ length: 1000 }, (_v, i) => `dong ${i + 1} ${i % 100 === 0 ? "LOI nghiem trong" : "binh thuong"}`).join("\n");

  it("mặc định đọc 200 dòng đầu có số dòng; start/end_line đọc đúng khoảng; có dòng 'continues at'", () => {
    const k = tao();
    const ma = k.luu({ runId: "r", ten: "t", noiDung: nhieuDong })!;
    const a = k.doc("r", ma, {});
    expect(a.ok && a.text).toContain("1000 lines");
    expect(a.ok && a.text).toContain("showing lines 1-200");
    expect(a.ok && a.text).toContain("1\tdong 1 LOI");
    expect(a.ok && a.text).toContain("continues at line 201");
    const b = k.doc("r", ma, { startLine: 500, endLine: 502 });
    expect(b.ok && b.text).toContain("500\tdong 500");
    expect(b.ok && b.text).toContain("502\tdong 502");
    expect(b.ok && b.text).not.toContain("503\t");
    const c = k.doc("r", ma, { startLine: 5000 });
    expect(c.ok && c.text).toContain("past the end");
  });

  it("grep không phân biệt hoa thường, tối đa 50 dòng, nói tổng số khớp", () => {
    const k = tao();
    const ma = k.luu({ runId: "r", ten: "t", noiDung: nhieuDong })!;
    const g = k.doc("r", ma, { grep: "loi nghiem" });
    expect(g.ok && g.text).toContain("10 matching lines");
    expect(g.ok && g.text).toContain("1\tdong 1 LOI");
    expect(g.ok && g.text).toContain("901\tdong 901 LOI");
    const nhieu = k.luu({ runId: "r", ten: "t", noiDung: Array.from({ length: 200 }, () => "khop").join("\n") })!;
    const g2 = k.doc("r", nhieu, { grep: "KHOP" });
    expect(g2.ok && g2.text).toContain("200 matching lines");
    expect(g2.ok && g2.text).toContain(`${200 - TRAN_DONG_GREP} more matching lines`);
    expect(g2.ok && g2.text.split("\n").filter((l) => /^\d+\tkhop$/.test(l)).length).toBe(TRAN_DONG_GREP);
  });

  it("một lần đọc không vượt TRAN_KY_TU_DOC", () => {
    const k = tao();
    const ma = k.luu({ runId: "r", ten: "t", noiDung: Array.from({ length: 300 }, () => "y".repeat(500)).join("\n") })!;
    const r = k.doc("r", ma, { startLine: 1, endLine: 300 });
    expect(r.ok && r.text.length).toBeLessThanOrEqual(TRAN_KY_TU_DOC + 120);
    expect(r.ok && r.text).toContain("output cut at");
  });

  it("★★★ khoá theo lượt: runId khác / mã bịa / sai khuôn ⇒ {ok:false} (CÙNG kết quả)", () => {
    const k = tao();
    const ma = k.luu({ runId: "cha", ten: "t", noiDung: "bi mat cua cha" })!;
    expect(k.doc("cha", ma, {})).toMatchObject({ ok: true });
    expect(k.doc("con", ma, {})).toEqual({ ok: false });
    expect(k.doc("cha", "out-00000000", {})).toEqual({ ok: false });
    for (const sai of ["", "../etc/passwd", "out-xyz", "OUT-1A2B3C4D", ma + "0", `${ma}\n`, "C:\\x"]) expect(k.doc("cha", sai, {}), sai).toEqual({ ok: false });
  });
});

describe("trần", () => {
  it("tệp > 2 MB ⇒ lưu phần đầu, ghi nhận bị cắt", () => {
    const k = tao();
    const ma = k.luu({ runId: "r", ten: "t", noiDung: "z".repeat(TRAN_BYTE_MOT_TEP + 5000) })!;
    const tep = fs.readdirSync(k.thuMuc()!).find((f) => f.endsWith(".txt"))!;
    expect(fs.statSync(path.join(k.thuMuc()!, tep)).size).toBe(TRAN_BYTE_MOT_TEP);
    const r = k.doc("r", ma, { startLine: 1, endLine: 1 });
    expect(r.ok && r.text).toContain("stored truncated at 2 MB");
  });

  it("★ tối đa 8 tệp mỗi lượt; lượt khác vẫn lưu được; dọn lượt trả lại chỗ", () => {
    const k = tao();
    for (let i = 0; i < TRAN_TEP_MOI_LUOT; i++) expect(k.luu({ runId: "a", ten: "t", noiDung: `x${i}` })).not.toBeNull();
    expect(k.luu({ runId: "a", ten: "t", noiDung: "tran" })).toBeNull();
    expect(k.luu({ runId: "b", ten: "t", noiDung: "khac" })).not.toBeNull();
    k.donLuot("a");
    expect(k.luu({ runId: "a", ten: "t", noiDung: "lai" })).not.toBeNull();
  });

  it("★ tối đa 16 MB mỗi lượt", () => {
    const k = tao();
    const mot = "q".repeat(TRAN_BYTE_MOT_TEP);
    const soVua = Math.floor(TRAN_BYTE_MOI_LUOT / TRAN_BYTE_MOT_TEP); // 8, nhưng bị chặn bởi 8 tệp: dùng 7 tệp lớn + 1 vừa vượt
    expect(soVua).toBe(8);
    for (let i = 0; i < 7; i++) expect(k.luu({ runId: "a", ten: "t", noiDung: mot })).not.toBeNull();
    expect(k.luu({ runId: "a", ten: "t", noiDung: mot })).not.toBeNull(); // chạm đúng 16 MB
    expect(k.luu({ runId: "a", ten: "t", noiDung: "x" })).toBeNull(); // 9 tệp / quá 16 MB
  });

  it("★ trần tổng 64 MB toàn kho", () => {
    const k = tao();
    const mot = "q".repeat(TRAN_BYTE_MOT_TEP);
    let luu = 0;
    for (let r = 0; r < 10; r++) for (let i = 0; i < 4; i++) if (k.luu({ runId: `r${r}`, ten: "t", noiDung: mot }) !== null) luu++;
    expect(luu * TRAN_BYTE_MOT_TEP).toBeLessThanOrEqual(TRAN_BYTE_TONG_KHO);
    expect(luu).toBe(Math.floor(TRAN_BYTE_TONG_KHO / TRAN_BYTE_MOT_TEP));
  });
});

describe("dọn", () => {
  it("donLuot xoá tệp của đúng lượt đó; lượt khác còn nguyên; mã đã dọn ⇒ không đọc được", () => {
    const k = tao();
    const a = k.luu({ runId: "a", ten: "t", noiDung: "A" })!;
    const b = k.luu({ runId: "b", ten: "t", noiDung: "B" })!;
    k.donLuot("a");
    expect(k.doc("a", a, {})).toEqual({ ok: false });
    expect(k.doc("b", b, {})).toMatchObject({ ok: true });
    expect(fs.readdirSync(k.thuMuc()!).filter((f) => f.endsWith(".txt"))).toHaveLength(1);
  });

  it("TTL 2 giờ: tệp hết hạn bị xoá ở lần lưu kế", () => {
    let t = 1_000_000;
    const k = tao({ bayGio: () => t });
    const cu = k.luu({ runId: "a", ten: "t", noiDung: "cu" })!;
    t += TTL_MS + 1;
    k.luu({ runId: "a", ten: "t", noiDung: "moi" });
    expect(k.doc("a", cu, {})).toEqual({ ok: false });
    expect(fs.readdirSync(k.thuMuc()!).filter((f) => f.endsWith(".txt"))).toHaveLength(1);
  });

  it("dongKho xoá cả thư mục của chính tiến trình", () => {
    const k = tao();
    k.luu({ runId: "a", ten: "t", noiDung: "x" });
    const dir = k.thuMuc()!;
    k.dongKho();
    expect(fs.existsSync(dir)).toBe(false);
    expect(k.thuMuc()).toBeNull();
  });
});

describe("quét rác lúc khởi động (KHÔNG dựa kill(pid,0))", () => {
  const goc = () => path.join(TMP, "thoca-dau-ra");
  /** dựng thư mục giả của tiến trình khác: tên p<pid>-<t>-<nonce>, có/không .nhip với mtime cho trước */
  function dungThuMuc(ten: string, o: { nhipTuoiMs?: number; khongNhip?: boolean; tepNoiDung?: string }) {
    const dir = path.join(goc(), ten);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.txt"), o.tepNoiDung ?? "rac");
    if (!o.khongNhip) {
      const nhip = path.join(dir, ".nhip");
      fs.writeFileSync(nhip, "x");
      const t = new Date(Date.now() - (o.nhipTuoiMs ?? 0));
      fs.utimesSync(nhip, t, t);
    }
    return dir;
  }

  it("★★★ nhịp im > 10 phút ⇒ coi là tiến trình chết ⇒ xoá; nhịp mới ⇒ GIỮ (dù PID trong tên là PID đã chết)", () => {
    const chet = dungThuMuc("p999999-1-aaaaaaaa", { nhipTuoiMs: IM_NHIP_TOI_DA_MS + 60_000 });
    const song = dungThuMuc("p999998-1-bbbbbbbb", { nhipTuoiMs: 5_000 });
    const k = tao();
    expect(k.quetRac()).toBe(1);
    expect(fs.existsSync(chet)).toBe(false);
    expect(fs.existsSync(song)).toBe(true);
  });

  it("★★★ PID TÁI DÙNG: thư mục mang PID của CHÍNH tiến trình này nhưng nhịp im ⇒ vẫn bị xoá (không tin PID); thư mục của mình không bị đụng", () => {
    const k = tao();
    k.luu({ runId: "a", ten: "t", noiDung: "cua minh" });
    const cu = dungThuMuc(`p${process.pid}-1-cccccccc`, { nhipTuoiMs: IM_NHIP_TOI_DA_MS + 1000 });
    const minh = k.thuMuc()!;
    expect(k.quetRac()).toBe(1);
    expect(fs.existsSync(cu)).toBe(false);
    expect(fs.existsSync(minh)).toBe(true);
  });

  it("thư mục KHÔNG có .nhip: giữ khi mtime còn mới, xoá khi mtime cũ > 10 phút", () => {
    const moi = dungThuMuc("p5-1-dddddddd", { khongNhip: true });
    const k = tao();
    expect(k.quetRac()).toBe(0);
    expect(fs.existsSync(moi)).toBe(true);
    const t = new Date(Date.now() - IM_NHIP_TOI_DA_MS - 60_000);
    fs.utimesSync(moi, t, t);
    expect(k.quetRac()).toBe(1);
  });

  it("chỉ xoá thư mục ĐÚNG khuôn p<pid>-<t>-<nonce>; tệp/thư mục lạ trong gốc kho không bị đụng", () => {
    fs.mkdirSync(goc(), { recursive: true });
    const la = path.join(goc(), "khong-phai-kho");
    fs.mkdirSync(la);
    const t = new Date(Date.now() - 10 * IM_NHIP_TOI_DA_MS);
    fs.utimesSync(la, t, t);
    fs.writeFileSync(path.join(goc(), "tep-la.txt"), "x");
    const k = tao();
    expect(k.quetRac()).toBe(0);
    expect(fs.existsSync(la)).toBe(true);
    expect(fs.existsSync(path.join(goc(), "tep-la.txt"))).toBe(true);
  });

  it("★ thư mục của CHÍNH mình không bị quét dù đồng hồ nhảy > 10 phút sau lúc tạo", () => {
    let t = Date.now();
    const k = tao({ bayGio: () => t });
    k.luu({ runId: "a", ten: "t", noiDung: "x" });
    t += IM_NHIP_TOI_DA_MS + 60_000;
    const minh = k.thuMuc()!;
    expect(k.quetRac()).toBe(0);
    expect(fs.existsSync(minh)).toBe(true);
  });

  it("quét tự chạy MỘT lần ở lần lưu đầu tiên", () => {
    const chet = dungThuMuc("p1-1-eeeeeeee", { nhipTuoiMs: IM_NHIP_TOI_DA_MS + 60_000 });
    const k = tao();
    expect(fs.existsSync(chet)).toBe(true); // chưa lưu ⇒ chưa quét
    k.luu({ runId: "a", ten: "t", noiDung: "x" });
    expect(fs.existsSync(chet)).toBe(false);
  });
});

describe("nhịp (heartbeat)", () => {
  it("thư mục có tệp .nhip sau lần lưu đầu; nhịp tự động bật khi KHÔNG tắt (và không giữ tiến trình sống)", () => {
    const k = taoKhoDauRaDai({ tmp: TMP, gocDuAn: DU_AN });
    kho.push(k);
    k.luu({ runId: "a", ten: "t", noiDung: "x" });
    expect(fs.existsSync(path.join(k.thuMuc()!, ".nhip"))).toBe(true);
    k.dongKho();
  });
});
