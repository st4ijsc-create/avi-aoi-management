/**
 * ★★★ ĐỢT G / TASK G3 / B2+B3 — LƯỚI TÍCH HỢP CHO LỚP ĐIỀU PHỐI CỦA `xuLyDeXuatCucBo` TRONG
 * `ui/bangChat.ts`: mức "chi_doc" báo sớm KHÔNG dựng thẻ, mức "tu_ghi" BỎ BƯỚC HỎI (tự gọi
 * `apDungCucBo()` thay vì đợi cú bấm), mức mặc định "hoi_truoc_khi_ghi" GIỮ NGUYÊN hành vi cũ
 * (dựng thẻ, đợi cú bấm).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TÁCH KHỎI `bangChat.unit.test.ts` (không mở rộng bản giả `vscode` ở đó)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `bangChat.unit.test.ts` tự khai ngay ở docblock đầu tệp: bản giả `vscode` ở đó CỐ Ý TỐI THIỂU,
 * và "mọi thứ nặng hơn (hoi đi tới mạng, apBanVa) đã có lưới riêng — dựng thêm ở đây chỉ đẻ ra một
 * bản mô phỏng thứ hai để rồi trôi khỏi bản kia." `xuLyDeXuatCucBo` (nơi B2/B3 sống) cần
 * `vscode.workspace.fs.readFile` THẬT (để đọc nội dung gốc dựng đề xuất) và `giaiDuongThat`/
 * `giaiDuongDeXuat` THẬT (đụng `node:fs` thật, không mock được bằng chuỗi) — hai thứ bản giả kia
 * hoàn toàn không có. Tệp NÀY dựng một bản giả RIÊNG, có `workspace.fs.readFile` đọc TỪ MỘT THƯ
 * MỤC TẠM THẬT, và **mock hẳn `./apBanVa`** (ranh giới MODULE, không phải một bản sao logic bên
 * trong nó) — đúng nguyên tắc "apBanVa đã có lưới riêng" mà tệp kia đặt ra: ở ĐÂY ta chỉ đo
 * `bangChat.ts` có GỌI `apBanVa` đúng lúc/đúng đối số hay không, KHÔNG đo lại BÊN TRONG `apBanVa`
 * (đã có `ui/apBanVa.mucQuyen.unit.test.ts`, đo trên đĩa THẬT, cho lớp hàng rào).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Ghi tệp fixture bằng API mức thấp — hai hàm ghi-tệp-một-lượt quen thuộc của `node:fs` nằm trong
 *  `CAM_TU` của `loi/census.unit.test.ts`, cấm ở TOÀN BỘ `src/` kể cả tệp lưới (xem cùng ghi chú ở
 *  `ui/apBanVa.mucQuyen.unit.test.ts`). */
function ghiTepThat(duong: string, noiDung: string): void {
  const fd = openSync(duong, "w");
  try {
    writeSync(fd, noiDung, null, "utf8");
  } finally {
    closeSync(fd);
  }
}

const may = vi.hoisted(() => ({
  nhanTin: undefined as undefined | ((m: Record<string, unknown>) => void),
  don: undefined as undefined | (() => void),
  daGui: [] as Array<Record<string, unknown>>,
  cookie: undefined as string | undefined,
  thuMucWorkspace: [] as string[],
  hangDoiSse: [] as Array<
    (dv: { nhan: (sk: Record<string, unknown>) => void; tinHieu?: AbortSignal }) => Promise<{ hong: string[] }>
  >,
  workspaceState: {} as Record<string, unknown>,
  /** Mỗi lời gọi `apBanVa` (module MOCK — xem `vi.mock("./apBanVa", …)` dưới). */
  apBanVaGoiVoi: [] as Array<Record<string, unknown>>,
}));

vi.mock("../mang/dongSse", () => ({
  moDongSse: (dv: { than: Record<string, unknown>; tinHieu?: AbortSignal; nhan: (sk: Record<string, unknown>) => void }) => {
    const ke = may.hangDoiSse.shift();
    if (ke) return ke(dv);
    return new Promise((_resolve, reject) => {
      dv.tinHieu?.addEventListener("abort", () => reject(dv.tinHieu!.reason), { once: true });
    });
  },
}));

vi.mock("../mang/toolCucBo", () => ({
  chayToolCucBo: async () => ({ ok: true, ketQua: "--- không dùng ở lưới này ---" }),
  danhSachTepGoiY: async () => [],
}));

vi.mock("../mang/trpc", () => ({
  goiTruyVanTrpc: async (_serverUrl: string, _cookie: string, ten: string) => {
    if (ten === "auth.me") return { id: 1, name: "nguoi_dung_thu" };
    return { projects: [] };
  },
}));

/**
 * ★★★ RANH GIỚI MODULE — KHÔNG một bản sao logic thứ hai của `apBanVa`. `apDungCucBo()` trong
 * `bangChat.ts` chỉ gọi `apBanVa({...})` rồi đọc `kq.thongDiep`; mock này chỉ cần trả một kết quả
 * hợp lý và GHI LẠI đối số nhận được — mọi khẳng định về HÀNG RÀO bên trong `apBanVa` (chi_doc
 * chặn, tu_ghi vẫn đủ hàng rào…) đã có lưới RIÊNG trên đĩa THẬT ở `ui/apBanVa.mucQuyen.unit.test.ts`.
 */
vi.mock("./apBanVa", () => ({
  apBanVa: async (dv: Record<string, unknown>) => {
    may.apBanVaGoiVoi.push(dv);
    return { ok: true, thongDiep: "Đã ghi vào workspace: (mock apBanVa cho lưới điều phối bangChat.ts)" };
  },
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }) },
  commands: { executeCommand: async () => undefined },
  window: {
    createWebviewPanel: () => ({
      webview: {
        html: "",
        onDidReceiveMessage: (h: (m: Record<string, unknown>) => void) => {
          may.nhanTin = h;
        },
        postMessage: async (m: Record<string, unknown>) => {
          may.daGui.push(m);
          return true;
        },
      },
      onDidDispose: (h: () => void) => {
        may.don = h;
      },
      reveal: () => undefined,
    }),
    showInformationMessage: () => Promise.resolve(undefined),
    showQuickPick: async () => undefined,
  },
  workspace: {
    get workspaceFolders() {
      return may.thuMucWorkspace.map((p) => ({ uri: { fsPath: p } }));
    },
    getConfiguration: () => ({ get: <T>(_k: string, mm: T) => mm }),
    fs: {
      // ĐỌC THẬT từ đĩa — `xuLyDeXuatCucBo` cần nội dung GỐC thật để dựng băm/diff của đề xuất.
      readFile: async (uri: { fsPath: string }): Promise<Buffer> => readFileSync(uri.fsPath),
    },
  },
}));

import { BangChat } from "./bangChat";

const khoGia = { quen: () => undefined, moDiff: async () => undefined, moDiffCucBo: async () => undefined };

function dungContextGia() {
  return {
    secrets: {
      get: async () => may.cookie,
      delete: async () => {
        may.cookie = undefined;
      },
    },
    globalState: {
      get: (_k: string, mm: unknown) => mm,
      update: async () => undefined,
    },
    workspaceState: {
      get: (k: string, mm: unknown) => (k in may.workspaceState ? may.workspaceState[k] : mm),
      update: async (k: string, v: unknown) => {
        if (v === undefined) delete may.workspaceState[k];
        else may.workspaceState[k] = v;
      },
    },
  };
}

function moBang(): Record<string, unknown> {
  BangChat.moHoacHien(dungContextGia() as never, khoGia as never);
  return (BangChat as unknown as { hienTai: Record<string, unknown> }).hienTai;
}

/** Một lượt SSE ĐƠN GIẢN — model trả lời NGUYÊN VĂN `traLoi` rồi báo "done" ngay (không yêu cầu đọc
 *  tool nào, nên vòng lặp tác nhân dừng sau ĐÚNG một vòng — cùng khuôn `bangChat.unit.test.ts`). */
function hangDoiMotVongDonGian(traLoi: string): typeof may.hangDoiSse {
  return [
    async (dv) => {
      dv.nhan({ type: "token", token: traLoi });
      dv.nhan({ type: "done" });
      return { hong: [] };
    },
  ];
}

/** Khối rào `avi-tool` hợp lệ cho `de_xuat_sua` (sửa TOÀN VĂN) — ĐÚNG cú pháp `loi/khoiAviTool.ts`
 *  (`phanTichKhoi` đòi `tool` + `args`, các trường thật nằm TRONG `args` — xem
 *  `loi/deXuatCucBo.unit.test.ts`, khuôn `KHOI` gốc, cho cùng cú pháp). */
function khoiDeXuatSua(path: string, modified: string): string {
  return "```avi-tool\n" + JSON.stringify({ tool: "de_xuat_sua", args: { path, modified } }) + "\n```";
}

let goc: string;
let ws: string;

beforeEach(() => {
  may.don?.();
  may.nhanTin = undefined;
  may.don = undefined;
  may.daGui = [];
  may.cookie = "cookie-gia";
  may.hangDoiSse = [];
  may.workspaceState = {};
  may.apBanVaGoiVoi = [];

  goc = realpathSync(mkdtempSync(join(tmpdir(), "bangchat-mq-")));
  ws = join(goc, "ws");
  mkdirSync(ws);
  ghiTepThat(join(ws, "a.ts"), "NOI DUNG GOC\n");
  may.thuMucWorkspace = [ws];
});

afterEach(() => {
  rmSync(goc, { recursive: true, force: true });
});

/** Dựng một BangChat ở chế độ LOCAL trỏ đúng `ws`, đặt mức quyền, rồi bắn một câu hỏi mà model trả
 *  lời bằng một đề xuất ghi hợp lệ trên `a.ts`. Trả về `may.daGui` sau khi mọi promise đã chạy hết. */
async function chayLuotDeXuat(mucQuyen: "chi_doc" | "hoi_truoc_khi_ghi" | "tu_ghi"): Promise<void> {
  const bang = moBang();
  bang.dsDuAn = [{ id: `local:${ws}`, nhan: `LOCAL · ${ws}`, loai: "local" }];
  bang.duAnChon = `local:${ws}`;
  if (mucQuyen !== "hoi_truoc_khi_ghi") {
    may.nhanTin?.({ loai: "dat_muc_quyen", mucQuyen });
    await new Promise((r) => setTimeout(r, 0));
  }
  may.daGui = [];
  may.hangDoiSse = hangDoiMotVongDonGian(khoiDeXuatSua("a.ts", "NOI DUNG MOI\n"));
  may.nhanTin?.({ loai: "hoi", cauHoi: "sửa a.ts giúp tôi" });
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("ĐỢT G / TASK G3 / B2 — mức 'chi_doc': báo sớm, KHÔNG dựng thẻ, KHÔNG gọi apBanVa", () => {
  it("★★★ đề xuất ghi ⇒ 'thong_bao' nói rõ bị chặn, KHÔNG 'the_duyet', apBanVa KHÔNG được gọi", async () => {
    await chayLuotDeXuat("chi_doc");

    expect(may.daGui.filter((m) => m.loai === "the_duyet")).toEqual([]);
    expect(may.apBanVaGoiVoi).toHaveLength(0);
    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.length).toBeGreaterThan(0);
    expect(thongBao.some((m) => String(m.thongDiep).includes("Chỉ đọc"))).toBe(true);
    // Đĩa THẬT không đổi — vì `xuLyDeXuatCucBo` không hề gọi tới `apDungCucBo`/`apBanVa`.
    expect(readFileSync(join(ws, "a.ts"), "utf8")).toBe("NOI DUNG GOC\n");
  });
});

describe("ĐỢT G / TASK G3 / B3 — mức 'tu_ghi': BỎ BƯỚC HỎI, tự gọi apDungCucBo() thay vì dựng thẻ", () => {
  it("★★★ đề xuất ghi ⇒ apBanVa được GỌI ĐÚNG MỘT LẦN với mucQuyen:'tu_ghi', KHÔNG 'the_duyet' nào hiện ra", async () => {
    await chayLuotDeXuat("tu_ghi");

    expect(may.daGui.filter((m) => m.loai === "the_duyet")).toEqual([]);
    expect(may.apBanVaGoiVoi).toHaveLength(1);
    expect(may.apBanVaGoiVoi[0]!.mucQuyen).toBe("tu_ghi");
    expect(may.apBanVaGoiVoi[0]!.duongTuongDoi).toBe("a.ts");
    // Kết quả (dù chỉ là lời khai của mock) vẫn phải được BÁO cho người dùng — không âm thầm.
    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.some((m) => String(m.thongDiep).includes("Đã ghi"))).toBe(true);
  });

  it("★ NHÁNH KIA — mặc định 'hoi_truoc_khi_ghi' vẫn dựng THẺ và CHỜ, KHÔNG tự gọi apBanVa", async () => {
    await chayLuotDeXuat("hoi_truoc_khi_ghi");

    const theDuyet = may.daGui.filter((m) => m.loai === "the_duyet");
    expect(theDuyet).toHaveLength(1);
    expect(theDuyet[0]!.duong).toBe("a.ts");
    expect(may.apBanVaGoiVoi).toHaveLength(0); // chưa bấm "Ghi vào workspace" ⇒ CHƯA gọi
  });
});
