/**
 * B1 `.csv` ở CỬA ĐỌC `moTepTrongHopCat` (cờ AI_AGENT_CSV_DOC + tuỳ chọn `choPhepCsv` của người gọi). THUẦN: thư mục tạm thật.
 * ĐỘT BIẾN PHẢI BẮT: mặc định BẬT · người gọi KHÁC (không `choPhepCsv`) cũng được · `.csv` ngoài sandbox-projects được · bỏ trần byte / dòng · cắt giữa dòng · bỏ che bí mật ·
 * bỏ báo đã cắt · byte thật bị sai · ngân sách phiên không bị trừ.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRAN_BYTE_DOC_CSV, TRAN_DONG_DOC_CSV } from "./csvTrongDuAn";
import { MA_TU_CHOI_HOP_CAT, duoiDuocPhep, moTepTrongHopCat, trangThaiNganSach, xoaSoNganSach } from "./repoSandbox";

let goc: string;
let sb: string;
let duAn: string;
const dongCsv = (n: number, rong = 8) => Array.from({ length: n }, (_, i) => `r${i},${"x".repeat(rong)}`).join("\n") + "\n";
const MO = () => ({ choPhepCsv: true, goc: duAn, gocSandboxProjects: sb });
beforeEach(() => {
  goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-rd-")));
  sb = path.join(goc, "sandbox-projects");
  duAn = path.join(sb, "agent-f");
  fs.mkdirSync(path.join(duAn, "du_lieu"), { recursive: true });
  fs.mkdirSync(path.join(goc, "docs"), { recursive: true });
  fs.writeFileSync(path.join(duAn, "du_lieu", "nho.csv"), "ma,so\nA,1\nB,2\n");
  fs.writeFileSync(path.join(goc, "docs", "ngoai.csv"), "a,b\n");
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  xoaSoNganSach();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(goc, { recursive: true, force: true });
});

describe("moTepTrongHopCat — .csv trong dự án (cờ bật + người gọi bật)", () => {
  it("★★★ đọc được `.csv` nhỏ trong dự án (đường tương đối KHÔNG chứa `sandbox-projects`): nội dung nguyên văn, byte thật, không cắt, csv.dongTra đúng", () => {
    const r = moTepTrongHopCat("du_lieu/nho.csv", MO());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.noiDung).toBe("ma,so\nA,1\nB,2\n");
    expect(r.byteTrenDia).toBe(14);
    expect(r.catBot).toBe(false);
    expect(r.csv).toEqual({ dongTra: 3, catTheoDong: false });
  });
  it("★★★ trần DÒNG: 250 dòng ⇒ trả đúng 200 dòng đầu, catBot=true, csv.catTheoDong=true, byteTrenDia là kích thước THẬT của tệp", () => {
    const nd = dongCsv(250);
    fs.writeFileSync(path.join(duAn, "du_lieu", "dai.csv"), nd);
    const r = moTepTrongHopCat("du_lieu/dai.csv", MO());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.noiDung).toBe(dongCsv(TRAN_DONG_DOC_CSV));
    expect(r.catBot).toBe(true);
    expect(r.csv).toEqual({ dongTra: 200, catTheoDong: true });
    expect(r.byteTrenDia).toBe(Buffer.byteLength(nd));
  });
  it("★★★ trần BYTE 32 KB: tệp ~60 KB dòng dài ⇒ nội dung ≤ 32 768 byte, KẾT THÚC ở ranh giới dòng (không dòng dở dang), catBot=true, byte thật đủ", () => {
    const nd = dongCsv(300, 190);
    fs.writeFileSync(path.join(duAn, "du_lieu", "to.csv"), nd);
    const r = moTepTrongHopCat("du_lieu/to.csv", MO());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.byteLength(r.noiDung)).toBeLessThanOrEqual(TRAN_BYTE_DOC_CSV);
    expect(r.noiDung.endsWith("\n")).toBe(true);
    expect(nd.startsWith(r.noiDung)).toBe(true);
    expect(r.noiDung.length).toBeGreaterThan(TRAN_BYTE_DOC_CSV - 400);
    expect(r.catBot).toBe(true);
    expect(r.byteTrenDia).toBe(Buffer.byteLength(nd));
  });
  it("★★★ KHÔNG lỗi khi vượt trần (trả phần đầu, ok:true)", () => {
    fs.writeFileSync(path.join(duAn, "du_lieu", "dai2.csv"), dongCsv(5000));
    expect(moTepTrongHopCat("du_lieu/dai2.csv", MO()).ok).toBe(true);
  });
  it("★★★ chuỗi hình khoá DÍNH CHỮ trong ô `.csv` bị che TRƯỚC khi vào kết quả (daChe=true, thân khoá không còn)", () => {
    const THAN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    fs.writeFileSync(path.join(duAn, "du_lieu", "khoa.csv"), `ma,ghi_chu\nA,tokenX${"sk-ant-api03-"}${THAN}\nB,github_pat_${THAN}${THAN}\nC,ok\n`);
    const r = moTepTrongHopCat("du_lieu/khoa.csv", MO());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.daChe).toBe(true);
    expect(r.noiDung).not.toContain(THAN);
    expect(r.noiDung).not.toContain(THAN.slice(0, 16));
    expect(r.noiDung).toContain("C,ok");
  });
  it("★★★ khoá nằm sát RANH GIỚI cắt byte không lọt: tệp > 32 KB mà khoá bắt đầu trước ranh giới và kéo qua nó ⇒ dòng dở bị bỏ, không để lộ nửa khoá", () => {
    const THAN = "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2";
    const dau = dongCsv(150, 200); // ~31 KB
    const gan = dau.length;
    const khoa = `K,${"sk-ant-api03-"}${THAN}\n`;
    const them = "x".repeat(TRAN_BYTE_DOC_CSV - gan - 10) + "\n";
    fs.writeFileSync(path.join(duAn, "du_lieu", "bien.csv"), dau + them + khoa + dongCsv(300, 100));
    const r = moTepTrongHopCat("du_lieu/bien.csv", MO());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.noiDung).not.toContain("sk-ant");
    expect(r.noiDung).not.toContain(THAN.slice(0, 8));
  });
  it("★★★ ngân sách phiên VẪN bị trừ theo byte đã trả (không phải đường đọc 'miễn phí')", () => {
    const truoc = trangThaiNganSach("u:csv").daDung;
    const r = moTepTrongHopCat("du_lieu/nho.csv", { ...MO(), khoaNganSach: "u:csv" });
    expect(r.ok).toBe(true);
    expect(trangThaiNganSach("u:csv").daDung - truoc).toBe(14);
  });
});

describe("moTepTrongHopCat — .csv bị TỪ CHỐI nguyên như cũ (DENIED_EXT, chi tiết `.csv`)", () => {
  const tuChoi = (r: ReturnType<typeof moTepTrongHopCat>) => {
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe(MA_TU_CHOI_HOP_CAT.DENIED_EXT);
    expect(r.chiTiet).toBe(".csv");
  };
  it("★★★ cờ TẮT (vắng / 0 / true) ⇒ từ chối dù người gọi bật", () => {
    for (const v of [undefined, "0", "true", ""]) {
      vi.unstubAllEnvs();
      if (v !== undefined) vi.stubEnv("AI_AGENT_CSV_DOC", v);
      else delete process.env.AI_AGENT_CSV_DOC;
      tuChoi(moTepTrongHopCat("du_lieu/nho.csv", MO()));
    }
  });
  it("★★★ cờ BẬT nhưng người gọi KHÁC (không `choPhepCsv`): IDE người dùng, cửa git, kiểm biên dịch ST… ⇒ từ chối", () => {
    tuChoi(moTepTrongHopCat("du_lieu/nho.csv", { goc: duAn, gocSandboxProjects: sb }));
    tuChoi(moTepTrongHopCat("du_lieu/nho.csv", { choPhepCsv: false, goc: duAn, gocSandboxProjects: sb }));
  });
  it("★★★ cờ BẬT + người gọi bật nhưng `.csv` NGOÀI sandbox-projects ⇒ từ chối (gốc repo, docs/)", () => {
    tuChoi(moTepTrongHopCat("docs/ngoai.csv", { choPhepCsv: true, goc, gocSandboxProjects: sb }));
    tuChoi(moTepTrongHopCat("ngoai.csv", { choPhepCsv: true, goc: path.join(goc, "docs"), gocSandboxProjects: sb }));
  });
  it("★★★ JUNCTION trong dự án trỏ ra ngoài sandbox-projects ⇒ từ chối", (ctx) => {
    try {
      fs.symlinkSync(path.join(goc, "docs"), path.join(duAn, "lk"), "junction");
    } catch {
      ctx.skip();
      return;
    }
    const r = moTepTrongHopCat("lk/ngoai.csv", MO());
    expect(r.ok).toBe(false);
  });
  it("★★★ duoiDuocPhep VẪN false cho .csv khi cờ bật (tập đuôi dùng chung không bị đổi)", () => {
    expect(duoiDuocPhep("a.csv")).toBe(false);
    expect(duoiDuocPhep("A.CSV")).toBe(false);
  });
  it("★★★ bị từ chối bởi chính sách khác vẫn từ chối: `.env.csv` / thư mục cấm / `..`", () => {
    expect(moTepTrongHopCat("../ngoai.csv", MO()).ok).toBe(false);
    expect(moTepTrongHopCat("node_modules/x.csv", MO()).ok).toBe(false);
    expect(moTepTrongHopCat(".env.csv", MO()).ok).toBe(false);
  });
});
