/**
 * CHỐT "dưới vitest chỉ được dùng worktree trong thư mục tạm" (sự cố 13/11 17:59: ca CLI / đột biến bỏ `--wt` rơi về worktree mặc định THẬT D:\SOURCES\_tho_ca_wt,
 * bộ chạy thật "cất" giữa một lượt pilot đang chạy). Chốt nằm trong chayMotViec() LÕI (không phải main()) nên một đột biến ở main() không gỡ được.
 *
 * AN TOÀN CỦA CHÍNH TỆP NÀY: không ca nào trỏ tới một worktree CÓ THẬT ngoài thư mục tạm. Ca "ngoài tạm" dùng đường KHÔNG TỒN TẠI, hoặc junction (trong tạm) tới `C:\Windows`
 * (thư mục có thật nhưng KHÔNG phải repo git ⇒ nếu chốt bị gỡ, bộ chạy dừng ở bước "không phải gốc worktree git" TRƯỚC khi sửa gì). Không ca nào chạm `D:\SOURCES\_tho_ca_wt`.
 * ĐỘT BIẾN PHẢI BẮT: bỏ chốt · đảo điều kiện VITEST · chốt SAU kiểm tồn tại · bỏ so dạng thật (junction) · so tiền tố không biên · `--wt` mặc định dưới vitest là đường thật.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, wtMacDinh, wtNgoaiTmpDuoiVitest } from "./chayMotViec";

const CHUOI = "chayMotViec chạy dưới vitest chỉ được dùng worktree trong thư mục tạm (os.tmpdir()) — từ chối để không chạm worktree thật";
const the = () => `MÃ: TC-92
MỤC TIÊU: thử chốt worktree tạm
TỆP ĐƯỢC PHÉP SỬA/TẠO: docs/ghi-chu.md
LỆNH KIỂM: npx vitest run scripts/x/a.test.ts
GIỚI HẠN: 1 phút, 3 vòng`;
const THAT = "D:\\SOURCES\\_tho_ca_wt";

let goc: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcchot-"));
  ra = path.join(goc, "ra");
});
afterEach(() => {
  for (const l of fs.readdirSync(goc)) {
    try {
      if (fs.lstatSync(path.join(goc, l)).isSymbolicLink()) fs.unlinkSync(path.join(goc, l));
    } catch {
      /* bỏ qua */
    }
  }
  fs.rmSync(goc, { recursive: true, force: true });
});

const chay = (wt: string, over: Partial<Parameters<typeof chayMotViec>[0]> = {}) => chayMotViec({ van: the(), wt, base: "HEAD", driver: "kho", ra, luat: "# l\n", ...over });
const KHONG_VITEST = {} as NodeJS.ProcessEnv;
const CO_VITEST = { VITEST: "true" } as NodeJS.ProcessEnv;

describe("wtMacDinh", () => {
  it("★★★ dưới vitest ⇒ thư mục TẠM (không phải đường thật); không vitest ⇒ đường cố định thật", () => {
    expect(wtMacDinh(CO_VITEST)).toBe(path.join(os.tmpdir(), "_tho_ca_wt_vitest_mac_dinh"));
    expect(wtMacDinh(CO_VITEST)).not.toBe(THAT);
    expect(wtMacDinh(KHONG_VITEST)).toBe(THAT);
  });
  it("★★ mặc định của tiến trình ĐANG chạy (vitest đặt VITEST) là thư mục tạm", () => {
    expect(wtMacDinh()).toBe(path.join(os.tmpdir(), "_tho_ca_wt_vitest_mac_dinh"));
  });
});

describe("wtNgoaiTmpDuoiVitest (thuần)", () => {
  it("★★★ không VITEST ⇒ null (chạy thật không bị chốt)", () => {
    expect(wtNgoaiTmpDuoiVitest(THAT, KHONG_VITEST)).toBeNull();
  });
  it("★★★ có VITEST: đường ngoài tạm (kể cả đường thật mặc định) ⇒ chuỗi từ chối; trong tạm ⇒ null", () => {
    expect(wtNgoaiTmpDuoiVitest(THAT, CO_VITEST)).toBe(CHUOI);
    expect(wtNgoaiTmpDuoiVitest("D:\\SOURCES\\_tho_ca_wt_khac", CO_VITEST)).toBe(CHUOI);
    expect(wtNgoaiTmpDuoiVitest(path.join(os.tmpdir(), "x", "_tho_ca_wt"), CO_VITEST)).toBeNull();
    expect(wtNgoaiTmpDuoiVitest(os.tmpdir(), CO_VITEST)).toBeNull();
  });
  it("★★★ anh em CÙNG TIỀN TỐ với thư mục tạm (`<tmp>-evil`) ⇒ từ chối (biên là dấu phân cách)", () => {
    expect(wtNgoaiTmpDuoiVitest(`${os.tmpdir()}-evil\\x`, CO_VITEST)).toBe(CHUOI);
  });
  it("★★★ JUNCTION nằm trong tạm nhưng trỏ ra ngoài ⇒ từ chối (so cả dạng thật)", () => {
    const lk = path.join(goc, "_tho_ca_junction");
    fs.symlinkSync("C:\\Windows", lk, "junction");
    expect(wtNgoaiTmpDuoiVitest(lk, CO_VITEST)).toBe(CHUOI);
    expect(wtNgoaiTmpDuoiVitest(path.join(lk, "System32"), CO_VITEST)).toBe(CHUOI);
  });
});

describe("chayMotViec() — chốt ở LÕI, trước mọi thao tác", () => {
  it("★★★ đường ngoài tạm KHÔNG TỒN TẠI dưới vitest ⇒ tu-choi bằng CHUỖI CHỐT (không phải 'không tồn tại' — chốt đứng TRƯỚC kiểm tồn tại)", async () => {
    const r = await chay("D:\\SOURCES\\_tho_ca_wt_khong_co_chot", { envVitest: CO_VITEST });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toBe(CHUOI);
  });
  it("★★★ đối chứng: KHÔNG vitest (chốt tắt) cùng đường ấy ⇒ rơi vào kiểm 'không tồn tại' (chứng tỏ ca trên thật sự bị chốt chặn)", async () => {
    const r = await chay("D:\\SOURCES\\_tho_ca_wt_khong_co_chot", { envVitest: KHONG_VITEST });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("worktree không tồn tại");
  });
  it("★★★ junction trong tạm → C:\\Windows (có thật, không phải repo) ⇒ chốt chặn; chốt tắt thì dừng ở bước 'không phải gốc worktree git' (vẫn không sửa gì)", async () => {
    const lk = path.join(goc, "_tho_ca_wt_junction");
    fs.symlinkSync("C:\\Windows", lk, "junction");
    const chan = await chay(lk, { envVitest: CO_VITEST });
    expect(chan.loi).toBe(CHUOI);
    const tat = await chay(lk, { envVitest: KHONG_VITEST });
    expect(tat.ketCuc).toBe("tu-choi");
    expect(tat.loi).not.toBe(CHUOI);
  });
  it("★★★ worktree TẠM hợp lệ dưới vitest ⇒ KHÔNG bị chốt chặn (chạy bình thường tới kết cục xong)", async () => {
    const kho = path.join(goc, "kho-chinh");
    const wt = path.join(goc, "_tho_ca_wt_tam");
    fs.mkdirSync(path.join(kho, "docs"), { recursive: true });
    const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
    git(kho, "init", "-q");
    git(kho, "config", "user.email", "t@t");
    git(kho, "config", "user.name", "t");
    fs.writeFileSync(path.join(kho, "docs/ghi-chu.md"), "cu\n");
    git(kho, "add", ".");
    git(kho, "commit", "-q", "-m", "init");
    git(kho, "worktree", "add", "-q", "--detach", wt, "HEAD");
    const r = await chay(wt, { envVitest: CO_VITEST });
    expect(r.loi).not.toBe(CHUOI);
    expect(["xong", "khong-lam"]).toContain(r.ketCuc);
  });
});
