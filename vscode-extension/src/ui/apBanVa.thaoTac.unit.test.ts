/**
 * ★★★ ĐỢT 4B — lưới THAO TÁC TỆP qua điểm ghi duy nhất `apBanVa`: tạo · xoá · đổi tên · thay nội dung NHIỀU tệp,
 * mức quyền chặn ở bước 0, dấu che mới bị chặn TRƯỚC sổ kiểm toán, và lời khai "đã ghi" chỉ khi ĐỌC LẠI đĩa khớp.
 *
 * "Đĩa" là một Map trong bộ nhớ (census cấm mọi tệp — kể cả lưới — ghi đĩa bằng `fs`). Đối tượng chỉnh-sửa giả ghi lại
 * từng phép (thay/tạo/xoá/đổi tên); `applyEdit` giả áp chúng lên Map — trừ khi ca cố ý mô phỏng "VSCode báo áp mà
 * đĩa không đổi" để đo nhánh CHƯA RÕ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const may = vi.hoisted(() => ({
  dia: new Map<string, string>(),
  boDem: new Map<string, string>(),
  ban: new Set<string>(),
  nhatKy: [] as string[],
  batDau: [] as Array<Record<string, unknown>>,
  chot: [] as Array<Record<string, unknown>>,
  /** `applyEdit` trả true nhưng KHÔNG đổi gì (đo nhánh CHƯA RÕ). */
  apKhongDoi: false,
  /** `applyEdit` trả false. */
  apTuChoi: false,
  /** ★ 4B-client — đối số xác thực của từng lượt ghi sổ + lỗi có mã khi mở sổ. */
  xacThuc: [] as unknown[],
  batDauLoi: undefined as (Error & { ma?: string }) | undefined,
}));

vi.mock("vscode", () => {
  class Range {
    constructor(
      public a: number,
      public b: number,
      public c: number,
      public d: number,
    ) {}
  }
  type Op =
    | { k: "replace"; p: string; nd: string }
    | { k: "create"; p: string; nd: string; o: Record<string, unknown> }
    | { k: "delete"; p: string }
    | { k: "rename"; p: string; q: string };
  class WorkspaceEdit {
    ops: Op[] = [];
    replace(u: { fsPath: string }, _r: unknown, nd: string) {
      this.ops.push({ k: "replace", p: u.fsPath, nd });
    }
    createFile(u: { fsPath: string }, o: { contents?: Uint8Array }) {
      this.ops.push({ k: "create", p: u.fsPath, nd: Buffer.from(o.contents ?? new Uint8Array()).toString("utf8"), o });
    }
    deleteFile(u: { fsPath: string }) {
      this.ops.push({ k: "delete", p: u.fsPath });
    }
    renameFile(a: { fsPath: string }, b: { fsPath: string }) {
      this.ops.push({ k: "rename", p: a.fsPath, q: b.fsPath });
    }
  }
  const uri = (p: string) => ({ fsPath: p, toString: () => `file://${p}` });
  const khongCo = (p: string) => Object.assign(new Error(`EntryNotFound (FileSystemError): ${p}`), { code: "FileNotFound" });
  const taiLieu = (p: string) => ({
    uri: uri(p),
    get isDirty() {
      return may.ban.has(p);
    },
    version: 1,
    get lineCount() {
      return (may.boDem.get(p) ?? may.dia.get(p) ?? "").split("\n").length;
    },
    validateRange: (r: unknown) => r,
    save: async () => {
      may.nhatKy.push(`save:${p}`);
      may.dia.set(p, may.boDem.get(p) ?? may.dia.get(p) ?? "");
      return true;
    },
  });
  return {
    Uri: { file: uri },
    Range,
    WorkspaceEdit,
    workspace: {
      get textDocuments() {
        return [...may.ban].map((p) => taiLieu(p));
      },
      fs: {
        readFile: async (u: { fsPath: string }) => {
          may.nhatKy.push(`doc:${u.fsPath}`);
          if (!may.dia.has(u.fsPath)) throw khongCo(u.fsPath);
          return Buffer.from(may.dia.get(u.fsPath)!, "utf8");
        },
        stat: async (u: { fsPath: string }) => {
          may.nhatKy.push(`stat:${u.fsPath}`);
          if (!may.dia.has(u.fsPath)) throw khongCo(u.fsPath);
          return { type: 1 };
        },
      },
      openTextDocument: async (u: { fsPath: string }) => taiLieu(u.fsPath),
      applyEdit: async (e: WorkspaceEdit) => {
        may.nhatKy.push(`ap:${e.ops.map((o) => o.k).join("+")}`);
        if (may.apTuChoi) return false;
        if (may.apKhongDoi) return true;
        for (const o of e.ops) {
          if (o.k === "replace") may.boDem.set(o.p, o.nd);
          if (o.k === "create") may.dia.set(o.p, o.nd);
          if (o.k === "delete") may.dia.delete(o.p);
          if (o.k === "rename") {
            may.dia.set(o.q, may.dia.get(o.p)!);
            may.dia.delete(o.p);
          }
        }
        return true;
      },
    },
  };
});

vi.mock("../mang/duyetGhi", () => ({
  goiBatDauApClient: async (_u: string, _c: unknown, dv: Record<string, unknown>) => {
    may.nhatKy.push("soTruoc");
    may.batDau.push(dv);
    may.xacThuc.push(_c);
    if (may.batDauLoi) throw may.batDauLoi;
    return { actionId: `ACT-${may.batDau.length}`, token: "TOK" };
  },
  goiChotApClient: async (_u: string, _c: unknown, dv: Record<string, unknown>) => {
    may.nhatKy.push("soSau");
    may.chot.push(dv);
    may.xacThuc.push(_c);
    return { ok: true };
  },
}));

vi.mock("../loi/duongThat", () => ({
  giaiDuongThat: (d: string) => ({ ok: true, duong: d }),
  giaiDuongThatChoTaoMoi: (d: string) => ({ ok: true, duong: d }),
}));

import { apBanVa, type DauVaoApBanVa } from "./apBanVa";

const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const BAM_RONG = bam("");
const WS = "C:\\ws";
const p = (r: string) => `${WS}\\${r.replace(/\//g, "\\")}`;

function dv(ghiDe: Partial<DauVaoApBanVa>): DauVaoApBanVa {
  return {
    duongTuyetDoi: p("a.ts"),
    duongTuongDoi: "a.ts",
    bamGoc: BAM_RONG,
    thuMucWorkspace: [WS],
    nhanWorkspace: WS,
    serverUrl: "http://gia",
    cookie: "c",
    mucQuyen: "hoi_truoc_khi_ghi",
    ...ghiDe,
  };
}

beforeEach(() => {
  may.dia.clear();
  may.boDem.clear();
  may.ban.clear();
  may.nhatKy.length = 0;
  may.batDau.length = 0;
  may.chot.length = 0;
  may.apKhongDoi = false;
  may.apTuChoi = false;
  may.xacThuc.length = 0;
  may.batDauLoi = undefined;
});

describe("apBanVa — TẠO tệp", () => {
  it("★★★ tạo tệp mới (kể cả thư mục chưa có): sổ TRƯỚC → ghi → đọc lại → chốt; khai băm ĐO được", async () => {
    const kq = await apBanVa(dv({ duongTuyetDoi: p("src/moi/b.ts"), duongTuongDoi: "src/moi/b.ts", thaoTac: { loai: "tao", noiDungMoi: "export const b = 1;\n" } }));
    expect(kq.ok).toBe(true);
    expect(kq.bamSauThat).toBe(bam("export const b = 1;\n"));
    expect(may.dia.get(p("src/moi/b.ts"))).toBe("export const b = 1;\n");
    const thuTu = may.nhatKy.filter((x) => ["soTruoc", "soSau"].includes(x) || x.startsWith("ap:"));
    expect(thuTu).toEqual(["soTruoc", "ap:create", "soSau"]);
    expect(may.batDau[0]).toMatchObject({ sha256Truoc: BAM_RONG, sha256Sau: bam("export const b = 1;\n"), path: "src/moi/b.ts" });
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam("export const b = 1;\n") });
  });

  it("★★★ tệp ĐÃ tồn tại ⇒ từ chối, KHÔNG mở sổ, KHÔNG ghi", async () => {
    may.dia.set(p("a.ts"), "cu");
    const kq = await apBanVa(dv({ thaoTac: { loai: "tao", noiDungMoi: "moi" } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/ĐÃ TỒN TẠI/);
    expect(may.batDau).toHaveLength(0);
    expect(may.dia.get(p("a.ts"))).toBe("cu");
  });

  it("★★★ (4.7) nội dung mang dấu che MỚI [REDACTED_EMAIL] ⇒ từ chối TRƯỚC sổ kiểm toán", async () => {
    const kq = await apBanVa(dv({ thaoTac: { loai: "tao", noiDungMoi: 'const mail = "[REDACTED_EMAIL]";\n' } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/REDACTED_EMAIL/);
    expect(may.batDau).toHaveLength(0);
    expect(may.dia.size).toBe(0);
  });

  it("★★★ VSCode báo đã áp nhưng đĩa KHÔNG có tệp ⇒ CHƯA RÕ, KHÔNG chốt sổ (không khai 'đã ghi', không khai 'không byte nào')", async () => {
    may.apKhongDoi = true;
    const kq = await apBanVa(dv({ thaoTac: { loai: "tao", noiDungMoi: "x" } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/CHƯA RÕ/);
    expect(may.chot).toHaveLength(0);
  });

  it("★★ tạo ngoài workspace ⇒ chặn ở duocPhepGhi", async () => {
    const kq = await apBanVa(dv({ duongTuyetDoi: "C:\\khac\\x.ts", duongTuongDoi: "x.ts", thaoTac: { loai: "tao", noiDungMoi: "x" } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/ngoài mọi thư mục workspace/);
    expect(may.batDau).toHaveLength(0);
  });

  it("★★ tạo .env ⇒ chặn (tệp nhạy cảm)", async () => {
    const kq = await apBanVa(dv({ duongTuyetDoi: p(".env"), duongTuongDoi: ".env", thaoTac: { loai: "tao", noiDungMoi: "A=1" } }));
    expect(kq.ok).toBe(false);
    expect(may.batDau).toHaveLength(0);
  });
});

describe("apBanVa — XOÁ / ĐỔI TÊN", () => {
  it("★★★ xoá: băm khớp ⇒ xoá, sổ băm-sau = băm rỗng, bamSauThat = null", async () => {
    may.dia.set(p("a.ts"), "noi dung\n");
    const kq = await apBanVa(dv({ bamGoc: bam("noi dung\n"), thaoTac: { loai: "xoa" } }));
    expect(kq.ok).toBe(true);
    expect(kq.bamSauThat).toBeNull();
    expect(may.dia.has(p("a.ts"))).toBe(false);
    expect(may.batDau[0]).toMatchObject({ sha256Truoc: bam("noi dung\n"), sha256Sau: BAM_RONG });
    expect(may.chot[0]).toMatchObject({ thanhCong: true });
  });

  it("★★★ xoá: tệp đã đổi từ lúc đề xuất ⇒ xung đột, không sổ, không xoá", async () => {
    may.dia.set(p("a.ts"), "ai do sua\n");
    const kq = await apBanVa(dv({ bamGoc: bam("ban cu\n"), thaoTac: { loai: "xoa" } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/đã đổi kể từ lúc đề xuất/);
    expect(may.dia.has(p("a.ts"))).toBe(true);
    expect(may.batDau).toHaveLength(0);
  });

  it("★★ xoá: tài liệu đang BẨN trong editor ⇒ từ chối", async () => {
    may.dia.set(p("a.ts"), "x");
    may.ban.add(p("a.ts"));
    const kq = await apBanVa(dv({ bamGoc: bam("x"), thaoTac: { loai: "xoa" } }));
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/CHƯA LƯU/);
  });

  it("★★ xoá: VSCode từ chối áp ⇒ đo lại thấy tệp còn nguyên ⇒ chốt thanhCong:false (đo được)", async () => {
    may.dia.set(p("a.ts"), "x");
    may.apTuChoi = true;
    const kq = await apBanVa(dv({ bamGoc: bam("x"), thaoTac: { loai: "xoa" } }));
    expect(kq.ok).toBe(false);
    expect(may.chot[0]).toMatchObject({ thanhCong: false });
  });

  it("★★★ đổi tên: nguồn khớp + đích trống ⇒ đổi, sổ ghi 'a → b'", async () => {
    may.dia.set(p("a.ts"), "A");
    const kq = await apBanVa(
      dv({ bamGoc: bam("A"), thaoTac: { loai: "doi-ten", duongDichTuyetDoi: p("lib/b.ts"), duongDichTuongDoi: "lib/b.ts" } }),
    );
    expect(kq.ok).toBe(true);
    expect(may.dia.get(p("lib/b.ts"))).toBe("A");
    expect(may.dia.has(p("a.ts"))).toBe(false);
    expect(may.batDau[0].path).toBe("a.ts → lib/b.ts");
  });

  it("★★★ đổi tên: đích ĐÃ tồn tại ⇒ không ghi đè", async () => {
    may.dia.set(p("a.ts"), "A");
    may.dia.set(p("b.ts"), "B");
    const kq = await apBanVa(dv({ bamGoc: bam("A"), thaoTac: { loai: "doi-ten", duongDichTuyetDoi: p("b.ts"), duongDichTuongDoi: "b.ts" } }));
    expect(kq.ok).toBe(false);
    expect(may.dia.get(p("b.ts"))).toBe("B");
  });

  it("★★ đổi tên sang .git/hooks ⇒ chặn ở hàng rào đích", async () => {
    may.dia.set(p("a.ts"), "A");
    const kq = await apBanVa(
      dv({ bamGoc: bam("A"), thaoTac: { loai: "doi-ten", duongDichTuyetDoi: p(".git/hooks/pre-commit"), duongDichTuongDoi: ".git/hooks/pre-commit" } }),
    );
    expect(kq.ok).toBe(false);
    expect(may.batDau).toHaveLength(0);
  });
});

describe("apBanVa — mức quyền + NHIỀU tệp + thay nội dung", () => {
  it("★★★ chi_doc chặn TẠI apBanVa ở bước 0 cho MỌI thao tác — không stat, không đọc, không mạng", async () => {
    may.dia.set(p("a.ts"), "A");
    for (const thaoTac of [
      { loai: "tao" as const, noiDungMoi: "x" },
      { loai: "xoa" as const },
      { loai: "thay" as const, noiDungMoi: "B" },
      { loai: "doi-ten" as const, duongDichTuyetDoi: p("b.ts"), duongDichTuongDoi: "b.ts" },
    ]) {
      const kq = await apBanVa(dv({ duongTuyetDoi: p(thaoTac.loai === "tao" ? "n.ts" : "a.ts"), bamGoc: bam("A"), thaoTac, mucQuyen: "chi_doc" }));
      expect(kq.ok).toBe(false);
      expect(kq.thongDiep).toMatch(/Chỉ đọc/);
    }
    expect(may.nhatKy).toEqual([]);
  });

  it("★★★ NHIỀU tệp trong một lượt: hai `thay` + một `tao` — mỗi tệp một sổ, mỗi tệp đọc lại", async () => {
    may.dia.set(p("a.ts"), "a1\n");
    may.dia.set(p("b.ts"), "b1\n");
    const k1 = await apBanVa(dv({ bamGoc: bam("a1\n"), thaoTac: { loai: "thay", noiDungMoi: "a2\n" } }));
    const k2 = await apBanVa(dv({ duongTuyetDoi: p("b.ts"), duongTuongDoi: "b.ts", bamGoc: bam("b1\n"), thaoTac: { loai: "thay", noiDungMoi: "b2\n" } }));
    const k3 = await apBanVa(dv({ duongTuyetDoi: p("c.ts"), duongTuongDoi: "c.ts", thaoTac: { loai: "tao", noiDungMoi: "c\n" } }));
    expect([k1.ok, k2.ok, k3.ok]).toEqual([true, true, true]);
    expect([may.dia.get(p("a.ts")), may.dia.get(p("b.ts")), may.dia.get(p("c.ts"))]).toEqual(["a2\n", "b2\n", "c\n"]);
    expect(may.batDau.map((b) => b.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(may.chot.every((c) => c.thanhCong === true)).toBe(true);
    expect(k1.bamSauThat).toBe(bam("a2\n"));
  });

  it("★★★ thay: dấu che MỚI «đã che» ⇒ từ chối trước sổ; dấu che VỐN CÓ trong tệp thì không chặn", async () => {
    may.dia.set(p("a.ts"), "const k = 1;\n");
    const k1 = await apBanVa(dv({ bamGoc: bam("const k = 1;\n"), thaoTac: { loai: "thay", noiDungMoi: "const k = «đã che»;\n" } }));
    expect(k1.ok).toBe(false);
    expect(may.batDau).toHaveLength(0);
    may.dia.set(p("d.md"), "Ví dụ: [REDACTED_SECRET]\n");
    const k2 = await apBanVa(
      dv({ duongTuyetDoi: p("d.md"), duongTuongDoi: "d.md", bamGoc: bam("Ví dụ: [REDACTED_SECRET]\n"), thaoTac: { loai: "thay", noiDungMoi: "Ví dụ: [REDACTED_SECRET] (giữ)\n" } }),
    );
    expect(k2.ok).toBe(true);
  });

  it("★★ thiếu cả đề xuất lẫn thao tác ⇒ từ chối rõ", async () => {
    const kq = await apBanVa(dv({}));
    expect(kq.ok).toBe(false);
  });
});

describe("apBanVa — thao tác tệp ghi sổ qua token cá nhân (4B-client)", () => {
  it("★★★ tạo tệp với tokenGateway ⇒ sổ trước + chốt sau đều `{bearer}`", async () => {
    const kq = await apBanVa(dv({ cookie: undefined, tokenGateway: "avgw_t", thaoTac: { loai: "tao", noiDungMoi: "x\n" } }));
    expect(kq.ok).toBe(true);
    expect(may.xacThuc).toEqual([{ bearer: "avgw_t" }, { bearer: "avgw_t" }]);
  });

  it("★★★ xoá tệp, sổ không mở được vì thiếu 'apply' ⇒ KHÔNG xoá, mã THIEU_PHAM_VI_APPLY", async () => {
    may.dia.set(p("a.ts"), "cu");
    may.batDauLoi = Object.assign(new Error("thiếu phạm vi 'apply' — đăng nhập lại để cấp quyền ghi sổ"), { ma: "THIEU_PHAM_VI_APPLY" });
    const kq = await apBanVa(dv({ cookie: undefined, tokenGateway: "avgw_cu", bamGoc: bam("cu"), thaoTac: { loai: "xoa" } }));
    expect(kq.ok).toBe(false);
    expect(kq.ma).toBe("THIEU_PHAM_VI_APPLY");
    expect(may.dia.get(p("a.ts"))).toBe("cu");
    expect(may.nhatKy.some((x) => x.startsWith("ap:"))).toBe(false);
    expect(may.chot).toHaveLength(0);
  });
});
