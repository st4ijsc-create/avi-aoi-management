/**
 * B1 `.csv` — phán quyết theo ĐƯỜNG + cắt đọc. THUẦN: thư mục tạm thật, không CSDL, không mạng.
 * Phạm vi do chủ dự án duyệt (14/11, qua HST): CHỈ ĐỌC, CHỈ đường dưới `sandbox-projects/**`; trần 32 KB / 200 dòng; mặc định TẮT (cờ AI_AGENT_CSV_DOC). GHI chưa được duyệt ⇒ không có ở đây.
 * ĐỘT BIẾN PHẢI BẮT: mặc định BẬT · cờ khác `1` cũng bật · kiểm CHUỖI `sandbox-projects` trên đường tương đối (bẫy goc = sandbox-projects/agent-f) · bỏ realpath
 * (junction trỏ ra ngoài) · bỏ trần dòng · bỏ trần byte · cắt giữa dòng · đuôi khác (.csv.txt) lọt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRAN_BYTE_DOC_CSV, TRAN_DONG_DOC_CSV, DAU_CHE_PEM_THIEU_END, catCsv, cheKhoiPemThieuEnd, csvBat, csvDuocPhep, laTepCsv } from "./csvTrongDuAn";

const chr10 = String.fromCharCode(10);
let goc: string; // "gốc repo" giả
let sb: string; // <goc>/sandbox-projects
let duAn: string; // <sb>/agent-f
beforeEach(() => {
  goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-b1-")));
  sb = path.join(goc, "sandbox-projects");
  duAn = path.join(sb, "agent-f");
  fs.mkdirSync(path.join(duAn, "py", "du_lieu"), { recursive: true });
  fs.mkdirSync(path.join(goc, "docs"), { recursive: true });
  fs.writeFileSync(path.join(duAn, "py", "du_lieu", "a.csv"), "x,y\n1,2\n");
  fs.writeFileSync(path.join(goc, "docs", "x.csv"), "x,y\n");
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(goc, { recursive: true, force: true });
});

describe("csvBat — cờ AI_AGENT_CSV_DOC mặc định TẮT", () => {
  it("★★★ chỉ đúng chuỗi `1` bật; vắng / rỗng / 0 / true / on / ' 1' / '1 ' ⇒ tắt", () => {
    expect(csvBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "TRUE", "on", "yes", " 1", "1 "]) expect(csvBat(v), String(v)).toBe(false);
  });
  it("★★★ csvDuocPhep đọc process.env TẠI CHỖ GỌI (đổi env giữa hai lần gọi ⇒ kết quả đổi)", () => {
    vi.stubEnv("AI_AGENT_CSV_DOC", "0");
    expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(false);
    vi.stubEnv("AI_AGENT_CSV_DOC", "1");
    expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(true);
  });
});

describe("laTepCsv", () => {
  it("★★★ chỉ đuôi `.csv` (không phân biệt hoa thường); `.csv.txt`, `csv`, `.csvx`, dotfile `.csv` thì không", () => {
    expect(laTepCsv("a.csv")).toBe(true);
    expect(laTepCsv("A.CSV")).toBe(true);
    for (const t of ["a.csv.txt", "csv", "a.csvx", ".csv", "a.tsv", "a.txt", "a"]) expect(laTepCsv(t), t).toBe(false);
  });
});

describe("csvDuocPhep — phán quyết theo ĐƯỜNG THẬT (realpath), fail-closed", () => {
  it("★★★ BẪY agent-f: gốc = sandbox-projects/agent-f, đường tương đối KHÔNG chứa chữ `sandbox-projects` ⇒ ĐƯỢC (kiểm trên đường tuyệt đối đã giải)", () => {
    expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(true);
  });
  it("★★★ gốc = gốc repo, đường đi vào sandbox-projects ⇒ ĐỌC được", () => {
    expect(csvDuocPhep(goc, "sandbox-projects/agent-f/py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(true);
  });
  it("★★★ `.csv` NGOÀI sandbox-projects (docs/, gốc repo) ⇒ KHÔNG", () => {
    expect(csvDuocPhep(goc, "docs/x.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(goc, "moi.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(path.join(goc, "docs"), "x.csv", { gocSandboxProjects: sb })).toBe(false);
  });
  it("★★★ thoát bằng `..` ra ngoài sandbox-projects ⇒ KHÔNG (bản thân vị từ không tin người gọi đã lọc `..`)", () => {
    expect(csvDuocPhep(duAn, "../../docs/x.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(duAn, "py/../../../docs/x.csv", { gocSandboxProjects: sb })).toBe(false);
  });
  it("★★★ JUNCTION nằm trong sandbox-projects nhưng trỏ ra ngoài ⇒ KHÔNG (realpath, không phải chuỗi)", (ctx) => {
    try {
      fs.symlinkSync(path.join(goc, "docs"), path.join(sb, "lk"), "junction");
    } catch {
      ctx.skip();
      return;
    }
    expect(csvDuocPhep(goc, "sandbox-projects/lk/x.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(path.join(sb, "lk"), "x.csv", { gocSandboxProjects: sb })).toBe(false);
  });
  it("★★★ thư mục ANH EM trùng tiền tố (`sandbox-projects-evil`) KHÔNG được coi là bên trong sandbox-projects (so theo đường, không so tiền tố chuỗi)", () => {
    const evil = path.join(goc, "sandbox-projects-evil");
    fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(path.join(evil, "x.csv"), "a,b" + chr10);
    expect(csvDuocPhep(evil, "x.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(goc, "sandbox-projects-evil/x.csv", { gocSandboxProjects: sb })).toBe(false);
    expect(csvDuocPhep(duAn, "../../sandbox-projects-evil/x.csv", { gocSandboxProjects: sb })).toBe(false);
  });
  it("★★★ cờ TẮT / khác `1` ⇒ KHÔNG, mọi tổ hợp", () => {
    for (const v of ["0", "", "true"]) {
      vi.stubEnv("AI_AGENT_CSV_DOC", v);
      expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: sb }), v).toBe(false);
    }
    vi.unstubAllEnvs();
    expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(false);
  });
  it("★★★ đuôi khác ⇒ KHÔNG (`a.csv.txt`, `a.tsv`, `a.py`, không đuôi)", () => {
    for (const t of ["py/du_lieu/a.csv.txt", "py/du_lieu/a.tsv", "py/a.py", "py/README"]) expect(csvDuocPhep(duAn, t, { gocSandboxProjects: sb }), t).toBe(false);
  });
  it("★★★ fail-closed: thư mục sandbox-projects không tồn tại / đường không phải chuỗi / rỗng ⇒ KHÔNG, không ném", () => {
    expect(csvDuocPhep(duAn, "py/du_lieu/a.csv", { gocSandboxProjects: path.join(goc, "khong-co") })).toBe(false);
    for (const d of [undefined, null, 42, "", {}]) expect(() => csvDuocPhep(duAn, d as unknown, { gocSandboxProjects: sb })).not.toThrow();
    for (const d of [undefined, null, 42, "", {}]) expect(csvDuocPhep(duAn, d as unknown, { gocSandboxProjects: sb }), String(d)).toBe(false);
  });
  it("★★ chính thư mục sandbox-projects làm gốc: đọc đường con được (gốc = sandbox-projects)", () => {
    expect(csvDuocPhep(sb, "agent-f/py/du_lieu/a.csv", { gocSandboxProjects: sb })).toBe(true);
  });
});

describe("cheKhoiPemThieuEnd — BEGIN không có END TƯƠNG ỨNG tới hết phần được đọc ⇒ che từ BEGIN tới hết", () => {
  const khoi = (nhan: string, so: number) => [`-----BEGIN ${nhan}-----`, ...Array.from({ length: so }, (_, i) => `THAN${i}` + "A".repeat(60)), `-----END ${nhan}-----`, ""].join(chr10);
  const dau = ["ma,ghi_chu", "A,ok", ""].join(chr10);
  it("★★★ BEGIN chưa có END (tệp nhỏ, đọc trọn) ⇒ giữ phần trước nguyên văn, từ DÒNG BEGIN tới hết thay bằng dấu cố định; không còn chữ BEGIN hay dòng thân", () => {
    const dở = khoi("PRIVATE KEY", 5).split(chr10).slice(0, 4).join(chr10) + chr10 + "B,sau" + chr10;
    const r = cheKhoiPemThieuEnd(dau + dở);
    expect(r.daChe).toBe(true);
    expect(r.text).toBe(dau + DAU_CHE_PEM_THIEU_END + chr10);
    expect(r.text).not.toContain("BEGIN");
    expect(r.text).not.toContain("THAN0");
    expect(r.text).not.toContain("B,sau");
  });
  it("★★★ khối ĐỦ (cùng nhãn) ⇒ KHÔNG đổi (để redactSecretsOnly che); hai khối đủ ⇒ không đổi; khối đủ rồi khối dở ⇒ chỉ khối dở bị che", () => {
    const du = khoi("PRIVATE KEY", 3);
    expect(cheKhoiPemThieuEnd(dau + du)).toEqual({ text: dau + du, daChe: false });
    const hai = du + khoi("RSA PRIVATE KEY", 2);
    expect(cheKhoiPemThieuEnd(hai)).toEqual({ text: hai, daChe: false });
    const dở = khoi("OPENSSH PRIVATE KEY", 6).split(chr10).slice(0, 3).join(chr10) + chr10;
    expect(cheKhoiPemThieuEnd(dau + du + dở)).toEqual({ text: dau + du + DAU_CHE_PEM_THIEU_END + chr10, daChe: true });
  });
  it("★★★ END LỆCH NHÃN (BEGIN PRIVATE KEY … END CERTIFICATE) = không tương ứng ⇒ che từ BEGIN (bộ che chung KHÔNG che ca này)", () => {
    const lech = ["-----BEGIN PRIVATE KEY-----", "THANTHAN" + "A".repeat(40), "-----END CERTIFICATE-----", ""].join(chr10);
    const r = cheKhoiPemThieuEnd(dau + lech);
    expect(r).toEqual({ text: dau + DAU_CHE_PEM_THIEU_END + chr10, daChe: true });
  });
  it("★★★ END nằm TRƯỚC BEGIN (không phải của nó) ⇒ BEGIN vẫn thiếu END ⇒ che", () => {
    const t = ["-----END PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----", "THAN" + "A".repeat(40), ""].join(chr10);
    expect(cheKhoiPemThieuEnd(t)).toEqual({ text: ["-----END PRIVATE KEY-----", DAU_CHE_PEM_THIEU_END, ""].join(chr10), daChe: true });
  });
  it("★★★ tiêu đề BEGIN dở (`-----BEGIN PRIV` bị cắt, hoặc không có dấu `-----` đóng) ⇒ che", () => {
    expect(cheKhoiPemThieuEnd(dau + "-----BEGIN PRIV").daChe).toBe(true);
    expect(cheKhoiPemThieuEnd(dau + "-----BEGIN PRIVATE KEY" + chr10 + "THAN").daChe).toBe(true);
  });
  it("★★★ BEGIN nằm GIỮA dòng (ô CSV có nháy) ⇒ che từ ĐẦU DÒNG đó (cả tiền tố `B,\"`)", () => {
    const dở = ["B,\"-----BEGIN PRIVATE KEY-----", "THANTHAN", ""].join(chr10);
    expect(cheKhoiPemThieuEnd(dau + dở)).toEqual({ text: dau + DAU_CHE_PEM_THIEU_END + chr10, daChe: true });
  });
  it("★★ không có BEGIN ⇒ nguyên văn; rỗng ⇒ rỗng; BEGIN ở đầu tệp, không END ⇒ chỉ còn dấu che", () => {
    expect(cheKhoiPemThieuEnd("a,b" + chr10)).toEqual({ text: "a,b" + chr10, daChe: false });
    expect(cheKhoiPemThieuEnd("")).toEqual({ text: "", daChe: false });
    expect(cheKhoiPemThieuEnd("-----BEGIN PRIVATE KEY-----" + chr10 + "x")).toEqual({ text: DAU_CHE_PEM_THIEU_END + chr10, daChe: true });
  });
  it("★★ dấu che cố định, không chứa BEGIN / END", () => {
    expect(DAU_CHE_PEM_THIEU_END).toBe("[REDACTED_PEM_BLOCK_WITHOUT_END]");
  });
});

describe("catCsv — trần 200 dòng, báo đã cắt", () => {
  const dong = (n: number) => Array.from({ length: n }, (_, i) => `r${i},${i}`).join("\n") + "\n";
  it("★★★ hằng công bố: 32 768 byte / 200 dòng", () => {
    expect(TRAN_BYTE_DOC_CSV).toBe(32_768);
    expect(TRAN_DONG_DOC_CSV).toBe(200);
  });
  it("★★★ đúng 200 dòng (có xuống dòng cuối) ⇒ KHÔNG cắt; 201 dòng ⇒ cắt còn 200, giữ nguyên chữ", () => {
    const a = catCsv(dong(200));
    expect(a).toEqual({ noiDung: dong(200), dong: 200, catTheoDong: false });
    const b = catCsv(dong(201));
    expect(b.catTheoDong).toBe(true);
    expect(b.dong).toBe(200);
    expect(b.noiDung).toBe(dong(200));
  });
  it("★★★ không có xuống dòng cuối: 200 dòng ⇒ không cắt; 201 ⇒ cắt", () => {
    const k = (n: number) => dong(n).slice(0, -1);
    expect(catCsv(k(200))).toEqual({ noiDung: k(200), dong: 200, catTheoDong: false });
    expect(catCsv(k(201)).catTheoDong).toBe(true);
  });
  it("★★ CRLF giữ nguyên; rỗng ⇒ 0 dòng; một dòng ⇒ 1", () => {
    const crlf = Array.from({ length: 250 }, (_, i) => `a${i}`).join("\r\n") + "\r\n";
    const c = catCsv(crlf);
    expect(c.dong).toBe(200);
    expect(c.noiDung.split("\n").length).toBe(201);
    expect(c.noiDung.endsWith("\r\n")).toBe(true);
    expect(catCsv("")).toEqual({ noiDung: "", dong: 0, catTheoDong: false });
    expect(catCsv("a,b")).toEqual({ noiDung: "a,b", dong: 1, catTheoDong: false });
  });
});
