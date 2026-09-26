/**
 * ★★★ ĐỢT G / TASK G3 — LƯỚI BẮT BUỘC CỦA B2/B3, ĐO TRÊN **ĐĨA THẬT** (`node:fs`, không mock).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TÁCH KHỎI `apBanVa.unit.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apBanVa.unit.test.ts` giả lập "ĐĨA" bằng một CHUỖI trong bộ nhớ (`may.dia`) — đúng cho lưới
 * THỨ TỰ BẤT BIẾN, nhưng KHÔNG chứng minh được điều kế hoạch G3 đòi: *"chi_doc ⇒ đọc lại tệp bằng
 * node:fs ⇒ đĩa không đổi một byte"*. Một khẳng định "đã gọi hàm chặn" (hay "may.dia không đổi")
 * không đo được gì THẬT — nó chỉ đo lại đúng bản giả tự mình dựng lên. Tệp này dùng **tệp thật
 * trên đĩa** (thư mục tạm), và kiểm cả bằng `readFileSync` **KHÔNG qua mock nào** ở TỪNG ca.
 *
 * `vscode` VẪN được giả lập (dựng cửa sổ VSCode thật không cần thiết cho lưới này và bị CẤM chạy
 * `npm run test-that`), nhưng khác hẳn `apBanVa.unit.test.ts`: mọi hàm giả ở đây gọi THẲNG xuống
 * `node:fs` thật trên CHÍNH tệp đang test — nếu BƯỚC 0 (chi_doc) lỡ KHÔNG chặn, đường ống phía sau
 * vẫn ĐỦ SỨC ghi byte thật xuống đĩa (không phải một no-op câm), nên một ca "chặn" ở đây chỉ xanh
 * khi BƯỚC 0 THẬT SỰ chặn, không phải vì phần còn lại tình cờ không làm gì.
 *
 * `loi/chanGhi.ts` / `loi/duongThat.ts` / `loi/eolLanLon.ts` / `loi/bamTep.ts` / `loi/ghepBanVa.ts`
 * / `loi/mucQuyen.ts` — TẤT CẢ giữ NGUYÊN cài đặt THẬT (không mock): B3 đòi "TỪNG hàng rào ở mức
 * tu_ghi", nên chính các hàng rào thật phải là thứ đang chạy.
 *
 * ⚠⚠ Hai hàm ghi-tệp-một-lượt quen thuộc của `node:fs` (đồng bộ và bất đồng bộ) nằm trong `CAM_TU`
 *   của `loi/census.unit.test.ts` — CẤM ở TOÀN BỘ `src/`, **kể cả tệp lưới** (census soi VĂN BẢN,
 *   nên NHẮC TÊN chúng dù chỉ trong một dòng ghi chú cũng bị đếm — xem docblock `ui/apBanVa.ts`,
 *   "VÌ SAO BÌNH LUẬN Ở ĐÂY KHÔNG GỌI TÊN HAI API ẤY", cùng lý do). `ghiTepThat` dưới đây dùng
 *   `openSync`+`writeSync`+`closeSync` (API mức thấp, không khớp bất kỳ từ cấm nào) để dựng
 *   fixture — chính ràng buộc đó là một phần của điều đang được đo: một lưới không thể tự vượt qua
 *   hàng rào nó đang kiểm bằng API bị hàng rào đó cấm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

function ghiTepThat(duong: string, noiDung: string): void {
  const fd = openSync(duong, "w");
  try {
    writeSync(fd, noiDung, null, "utf8");
  } finally {
    closeSync(fd);
  }
}

function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const may = vi.hoisted(() => ({
  /** Đường của tài liệu ĐANG MỞ (`openTextDocument` gán) — `save()` ghi thật vào ĐÚNG đường này. */
  duongDangMo: "" as string,
  /** Nội dung đang CHỜ (do `WorkspaceEdit.replace` đặt) — `undefined` ⇒ `applyEdit`/`save` chưa
   *  từng được gọi cho tài liệu này TRONG lượt hiện tại. */
  noiDungCho: undefined as string | undefined,
  batDau: [] as Array<Record<string, unknown>>,
  chot: [] as Array<Record<string, unknown>>,
}));

vi.mock("vscode", () => {
  class Range {}
  class WorkspaceEdit {
    replace(_uri: { fsPath: string }, _range: unknown, noiDung: string): void {
      may.noiDungCho = noiDung;
    }
  }
  return {
    Uri: { file: (p: string) => ({ fsPath: p }) },
    Range,
    WorkspaceEdit,
    workspace: {
      fs: {
        // ĐỌC THẬT — mấu chốt của cả tệp này: nếu BƯỚC 0 lỡ KHÔNG chặn, mọi bước sau vẫn thấy
        // và thao tác đúng NHỮNG BYTE THẬT nằm trên đĩa (không phải một con số giả lập).
        readFile: async (uri: { fsPath: string }): Promise<Buffer> => readFileSync(uri.fsPath),
      },
      openTextDocument: async (uri: { fsPath: string }) => {
        may.duongDangMo = uri.fsPath;
        return {
          isDirty: false,
          version: 1,
          get lineCount(): number {
            return readFileSync(uri.fsPath, "utf8").split("\n").length;
          },
          validateRange: (r: unknown) => r,
          save: async (): Promise<boolean> => {
            if (may.noiDungCho === undefined) return false;
            ghiTepThat(may.duongDangMo, may.noiDungCho);
            return true;
          },
        };
      },
      applyEdit: async (): Promise<boolean> => true,
    },
  };
});

vi.mock("../mang/duyetGhi", () => ({
  goiBatDauApClient: async (_u: string, _c: string, dv: Record<string, unknown>) => {
    may.batDau.push(dv);
    return { actionId: "ACT-THAT", token: "TOK-THAT" };
  },
  goiChotApClient: async (_u: string, _c: string, dv: Record<string, unknown>) => {
    may.chot.push(dv);
    return { ok: true };
  },
}));

import { apBanVa } from "./apBanVa";

beforeEach(() => {
  may.duongDangMo = "";
  may.noiDungCho = undefined;
  may.batDau = [];
  may.chot = [];
});

describe("apBanVa — ĐỢT G / TASK G3 / B2: mức 'chi_doc' CHẶN TẠI apBanVa, ĐO TRÊN ĐĨA THẬT", () => {
  const GOC_ND = "dong 1\ndong 2\ndong 3\n";
  const MOI_ND = "dong 1\nDONG 2 DA SUA\ndong 3\n";
  let goc: string;
  let ws: string;
  let tep: string;

  beforeEach(() => {
    goc = realpathSync(mkdtempSync(join(tmpdir(), "apbanva-mq-chidoc-")));
    ws = join(goc, "ws");
    mkdirSync(ws);
    tep = join(ws, "a.ts");
    ghiTepThat(tep, GOC_ND);
  });

  afterEach(() => {
    rmSync(goc, { recursive: true, force: true });
  });

  function dauVao(mucQuyen: "chi_doc" | "hoi_truoc_khi_ghi" | "tu_ghi"): Parameters<typeof apBanVa>[0] {
    return {
      deXuat: { loai: "toanVan", path: "a.ts", modified: MOI_ND },
      duongTuyetDoi: tep,
      duongTuongDoi: "a.ts",
      bamGoc: bam(GOC_ND),
      thuMucWorkspace: [ws],
      nhanWorkspace: "ws",
      serverUrl: "http://may-chu-gia",
      cookie: "cookie-gia",
      mucQuyen,
    };
  }

  it("★★★ LƯỚI BẮT BUỘC — 'chi_doc' + đề xuất ghi đi THẲNG vào apBanVa ⇒ đĩa THẬT KHÔNG đổi một byte (đọc lại bằng node:fs)", async () => {
    const kq = await apBanVa(dauVao("chi_doc"));

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("Chỉ đọc");

    // ★★★ KẾT CỤC — đọc THẲNG bằng node:fs, KHÔNG qua bất kỳ mock nào.
    const diaThat = readFileSync(tep, "utf8");
    expect(diaThat).toBe(GOC_ND);
    expect(diaThat).not.toBe(MOI_ND);

    // Chặn TRƯỚC MỌI bước khác: không mở sổ kiểm toán, không gọi mạng, không mở tài liệu.
    expect(may.batDau).toHaveLength(0);
    expect(may.chot).toHaveLength(0);
    expect(may.duongDangMo).toBe("");
  });

  it("★ NHÁNH KIA (1/2) — CÙNG lượt ghi ấy với 'hoi_truoc_khi_ghi' ⇒ ĐƯỢC PHÉP, đĩa THẬT đổi (chứng minh ca trên chặn vì mucQuyen, không phải vì hàng rào khác)", async () => {
    const kq = await apBanVa(dauVao("hoi_truoc_khi_ghi"));

    expect(kq.ok).toBe(true);
    expect(readFileSync(tep, "utf8")).toBe(MOI_ND);
    expect(may.batDau).toHaveLength(1);
    expect(may.chot).toHaveLength(1);
  });

  it("★ NHÁNH KIA (2/2) — 'tu_ghi' CŨNG được phép ghi, không phải chỉ 'hoi_truoc_khi_ghi' mới qua được BƯỚC 0", async () => {
    const kq = await apBanVa(dauVao("tu_ghi"));

    expect(kq.ok).toBe(true);
    expect(readFileSync(tep, "utf8")).toBe(MOI_ND);
    expect(may.batDau).toHaveLength(1);
    expect(may.chot).toHaveLength(1);
  });
});

describe("apBanVa — ĐỢT G / TASK G3 / B3: mức 'tu_ghi' vẫn đi ĐỦ hàng rào (ĐO TỪNG HÀNG RÀO TRÊN ĐĨA THẬT)", () => {
  let goc: string;
  let ws: string;
  let ngoai: string;

  beforeEach(() => {
    goc = realpathSync(mkdtempSync(join(tmpdir(), "apbanva-mq-tughi-")));
    ws = join(goc, "ws");
    ngoai = join(goc, "ngoai");
    mkdirSync(ws);
    mkdirSync(ngoai);
  });

  afterEach(() => {
    rmSync(goc, { recursive: true, force: true });
  });

  it("★★★ duocPhepGhi (đường NGOÀI mọi thư mục workspace) ⇒ CHẶN, đĩa THẬT không đổi", async () => {
    const NGOAI_ND = "bi mat\n";
    const tepNgoai = join(ngoai, "bi-mat.txt");
    ghiTepThat(tepNgoai, NGOAI_ND);

    const kq = await apBanVa({
      deXuat: { loai: "toanVan", path: "bi-mat.txt", modified: "DA SUA\n" },
      duongTuyetDoi: tepNgoai,
      duongTuongDoi: "../ngoai/bi-mat.txt",
      bamGoc: bam(NGOAI_ND),
      thuMucWorkspace: [ws], // workspace CHỈ là `ws`; tệp đích nằm ở `ngoai`, ANH EM của `ws`
      nhanWorkspace: "ws",
      serverUrl: "x",
      cookie: "y",
      mucQuyen: "tu_ghi",
    });

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("ngoài mọi thư mục workspace");
    expect(readFileSync(tepNgoai, "utf8")).toBe(NGOAI_ND);
    expect(may.batDau).toHaveLength(0);
  });

  it("★★★ camGhiRieng (.git/hooks/pre-commit) ⇒ CHẶN, đĩa THẬT không đổi", async () => {
    const gitHooks = join(ws, ".git", "hooks");
    mkdirSync(gitHooks, { recursive: true });
    const HOOK_ND = "#!/bin/sh\necho ok\n";
    const hookPath = join(gitHooks, "pre-commit");
    ghiTepThat(hookPath, HOOK_ND);

    const kq = await apBanVa({
      deXuat: { loai: "toanVan", path: ".git/hooks/pre-commit", modified: "rm -rf /\n" },
      duongTuyetDoi: hookPath,
      duongTuongDoi: ".git/hooks/pre-commit",
      bamGoc: bam(HOOK_ND),
      thuMucWorkspace: [ws],
      nhanWorkspace: "ws",
      serverUrl: "x",
      cookie: "y",
      mucQuyen: "tu_ghi",
    });

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain(".git");
    expect(readFileSync(hookPath, "utf8")).toBe(HOOK_ND);
    expect(may.batDau).toHaveLength(0);
  });

  it("★★★ duongThat (liên kết thoát RA NGOÀI workspace) ⇒ CHẶN, đĩa THẬT không đổi", async () => {
    // Windows: junction (liên kết THƯ MỤC) không cần quyền Administrator, khác symlink TỆP — cùng
    // kỹ thuật đã dùng ở `duongThat.unit.test.ts`.
    const loaiLk = process.platform === "win32" ? "junction" : "dir";
    const biMatDir = join(ngoai, "bi-mat-dir");
    mkdirSync(biMatDir);
    const NGOAI_ND = "toi la bi mat\n";
    const tepBiMat = join(biMatDir, "x.txt");
    ghiTepThat(tepBiMat, NGOAI_ND);
    const lienKet = join(ws, "lk-ra-ngoai");
    symlinkSync(biMatDir, lienKet, loaiLk);
    const duongQuaLienKet = join(lienKet, "x.txt");

    const kq = await apBanVa({
      deXuat: { loai: "toanVan", path: "lk-ra-ngoai/x.txt", modified: "DA SUA\n" },
      duongTuyetDoi: duongQuaLienKet,
      duongTuongDoi: "lk-ra-ngoai/x.txt",
      bamGoc: bam(NGOAI_ND),
      thuMucWorkspace: [ws],
      nhanWorkspace: "ws",
      serverUrl: "x",
      cookie: "y",
      mucQuyen: "tu_ghi",
    });

    expect(kq.ok).toBe(false);
    expect(readFileSync(tepBiMat, "utf8")).toBe(NGOAI_ND);
    expect(may.batDau).toHaveLength(0);
  });

  it("★★★ fail-closed EOL LẪN LỘN ⇒ CHẶN, đĩa THẬT không đổi", async () => {
    const LAN_LON = "M1\r\nM2\nM3\r\nM4\n";
    const tepLanLon = join(ws, "b.ts");
    ghiTepThat(tepLanLon, LAN_LON);

    const kq = await apBanVa({
      deXuat: { loai: "toanVan", path: "b.ts", modified: "DA SUA\n" },
      duongTuyetDoi: tepLanLon,
      duongTuongDoi: "b.ts",
      bamGoc: bam(LAN_LON),
      thuMucWorkspace: [ws],
      nhanWorkspace: "ws",
      serverUrl: "x",
      cookie: "y",
      mucQuyen: "tu_ghi",
    });

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("EOL LẪN LỘN");
    expect(readFileSync(tepLanLon, "utf8")).toBe(LAN_LON);
    expect(may.batDau).toHaveLength(0);
  });

  it("★ NHÁNH KIA (kiểm toán TRƯỚC/SAU vẫn ĐỦ) — 'tu_ghi' với đề xuất HỢP LỆ vẫn MỞ SỔ kiểm toán TRƯỚC khi ghi và CHỐT SAU, đĩa THẬT đổi đúng nội dung", async () => {
    const OK_ND = "dong 1\ndong 2\n";
    const tepOk = join(ws, "c.ts");
    ghiTepThat(tepOk, OK_ND);
    const MOI = "dong 1\nDA SUA\n";

    const kq = await apBanVa({
      deXuat: { loai: "toanVan", path: "c.ts", modified: MOI },
      duongTuyetDoi: tepOk,
      duongTuongDoi: "c.ts",
      bamGoc: bam(OK_ND),
      thuMucWorkspace: [ws],
      nhanWorkspace: "ws",
      serverUrl: "x",
      cookie: "y",
      mucQuyen: "tu_ghi",
    });

    expect(kq.ok).toBe(true);
    expect(readFileSync(tepOk, "utf8")).toBe(MOI);
    // Hàng rào KHÔNG bị "tự trị" tắt: sổ kiểm toán vẫn mở TRƯỚC và chốt SAU, y hệt 'hoi_truoc_khi_ghi'.
    expect(may.batDau).toHaveLength(1);
    expect(may.batDau[0]).toMatchObject({ path: "c.ts", sha256Truoc: bam(OK_ND), sha256Sau: bam(MOI) });
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam(MOI) });
  });
});
