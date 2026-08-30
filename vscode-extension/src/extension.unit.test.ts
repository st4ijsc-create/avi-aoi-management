/**
 * ★★★ F3 (2026-08-30) — LƯỚI CHO ĐƯỜNG **CMD+K** Ở WORKSPACE NHIỀU THƯ MỤC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY PHẢI CHẠY QUA `activate()` CHỨ KHÔNG GỌI HÀM TRONG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `chaySuaDoanChon` không export (và không nên export — nó là chi tiết cài đặt của một lệnh). Thứ
 * cần đo cũng không phải "hàm ấy làm gì" mà là **CHUỖI người dùng thật đi qua**: bấm `ctrl+alt+k`
 * ⇒ VSCode gọi lệnh đã đăng ký ⇒ câu hỏi được dựng ⇒ bơm vào bảng chat. Nên lưới đăng ký lệnh y
 * như VSCode làm, rồi bấm chính cái lệnh đó.
 *
 * ⚠⚠ BẢN GIẢ `asRelativePath` PHẢI TRUNG THỰC. Chính hàm ấy là thủ phạm của F3: nó **tự thêm tên
 *    thư mục làm tiền tố khi workspace có ≥2 thư mục**. Một bản giả "trả về đường tương đối cho
 *    xong" sẽ làm lưới này XANH cho cả mã CHƯA VÁ — tức đo một hành vi không tồn tại, đúng lớp lỗi
 *    mà cả dự án này đang đi vá. Bản giả dưới đây cài đúng hành vi tài liệu của VSCode.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const may = vi.hoisted(() => ({
  lenh: new Map<string, () => unknown>(),
  /** Câu hỏi mà `BangChat.guiCauHoiTuLenh` nhận được — đầu ra THẬT của đường Cmd+K. */
  cauHoiDaGui: [] as string[],
  thongBao: [] as string[],
  /** Đáp của ô nhập "muốn sửa như thế nào" (`undefined` ⇒ người dùng bấm Esc). */
  yeuCauNguoiDung: "đổi tên biến" as string | undefined,
  thuMucWs: [] as string[],
  tepDangMo: undefined as string | undefined,
  doanChon: "let a = 1;",
  chonRong: false,
}));

vi.mock("vscode", () => {
  const workspace = {
    get workspaceFolders() {
      return may.thuMucWs.map((p) => ({ uri: { fsPath: p } }));
    },
    getConfiguration: () => ({ get: <T>(_k: string, mm: T) => mm }),
    registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
    /**
     * ★★ HÀNH VI THẬT của VSCode (docs `workspace.asRelativePath`): "the workspace folder name is
     * included when there are MULTIPLE workspace folders" — đây chính là thứ F3 nói tới.
     */
    asRelativePath: (u: { fsPath: string }): string => {
      for (const goc of may.thuMucWs) {
        if (!u.fsPath.toLowerCase().startsWith(`${goc.toLowerCase()}\\`)) continue;
        const duoi = u.fsPath.slice(goc.length + 1).replace(/\\/g, "/");
        return may.thuMucWs.length > 1 ? `${goc.split("\\").pop()}/${duoi}` : duoi;
      }
      return u.fsPath;
    },
  };
  return {
    Uri: { file: (p: string) => ({ fsPath: p }) },
    ViewColumn: { Beside: 2 },
    commands: {
      registerCommand: (id: string, h: () => unknown) => {
        may.lenh.set(id, h);
        return { dispose: () => undefined };
      },
    },
    window: {
      get activeTextEditor() {
        if (!may.tepDangMo) return undefined;
        return {
          document: { uri: { fsPath: may.tepDangMo }, getText: () => may.doanChon },
          selection: { isEmpty: may.chonRong, start: { line: 4 }, end: { line: 6 } },
        };
      },
      showInputBox: async () => may.yeuCauNguoiDung,
      showInformationMessage: (s: string) => {
        may.thongBao.push(s);
        return Promise.resolve(undefined);
      },
      showErrorMessage: (s: string) => {
        may.thongBao.push(s);
        return Promise.resolve(undefined);
      },
    },
    workspace,
  };
});

// Bảng chat + kho đề xuất bị thay: lưới này đo ĐÚNG một thứ — chuỗi câu hỏi đi ra khỏi Cmd+K.
vi.mock("./ui/bangChat", () => ({
  BangChat: {
    moHoacHien: () => ({
      guiCauHoiTuLenh: (c: string) => {
        may.cauHoiDaGui.push(c);
      },
    }),
  },
}));
vi.mock("./ui/diffDeXuat", () => ({
  SCHEME: "avi-de-xuat",
  KhoDeXuat: class {
    dispose(): void {
      /* không giữ tài nguyên nào trong lưới */
    }
  },
}));

import { activate } from "./extension";

async function bamCmdK(): Promise<void> {
  activate({ subscriptions: [], secrets: {} } as never);
  may.lenh.get("aviAiLocal.suaDoanChon")!();
  // Lệnh chạy async (đợi ô nhập) — nhường vài nhịp cho chuỗi promise chạy hết.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  may.lenh = new Map();
  may.cauHoiDaGui = [];
  may.thongBao = [];
  may.yeuCauNguoiDung = "đổi tên biến";
  may.thuMucWs = [];
  may.tepDangMo = undefined;
  may.doanChon = "let a = 1;";
  may.chonRong = false;
});

describe("Cmd+K — đường dẫn đưa cho model (F3)", () => {
  it("★★★ WORKSPACE NHIỀU GỐC: đường KHÔNG mang tiền tố tên thư mục", async () => {
    /**
     * ★★★ Bản cũ đưa cho model `"lib/x.ts"`. Phía ghi quy đường ấy về tuyệt đối bằng gốc của DỰ ÁN
     * ĐANG CHỌN (`app`) ⇒ `app/lib/x.ts`. Nếu thư mục con `app/lib/` tồn tại thật thì đó là một tệp
     * KHÁC, CÓ THẬT: đọc được, băm khớp chính nó, nằm trong workspace ⇒ mọi hàng rào cho qua và thẻ
     * duyệt trông hoàn toàn hợp lý. Đây là lượt ghi nhầm tệp mà KHÔNG một cảnh báo nào bật lên.
     */
    may.thuMucWs = ["C:\\ws\\app", "C:\\ws\\lib"];
    may.tepDangMo = "C:\\ws\\lib\\x.ts";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(1);
    const cauHoi = may.cauHoiDaGui[0];
    expect(cauHoi).toContain('"x.ts"');
    expect(cauHoi).not.toContain("lib/x.ts");
    // Và cả trong khối JSON mẫu (`args.path`) — model chép lại chính chuỗi đó vào đề xuất.
    expect(cauHoi).toContain('"path":"x.ts"');
  });

  it("★★★ HÌNH DẠNG ĐỤNG THƯ MỤC CON: gốc `lib` và `app/lib/` cùng có ⇒ vẫn không sinh tiền tố", async () => {
    // Đây đúng hình dạng xấu nhất của F3. Không có tiền tố thì cũng không có gì để đụng.
    may.thuMucWs = ["C:\\ws\\app", "C:\\ws\\lib"];
    may.tepDangMo = "C:\\ws\\lib\\sub\\x.ts";

    await bamCmdK();

    expect(may.cauHoiDaGui[0]).toContain('"sub/x.ts"');
    expect(may.cauHoiDaGui[0]).not.toContain("lib/sub/x.ts");
  });

  it("★★★ MỘT gốc duy nhất ⇒ hành vi KHÔNG đổi (đường tương đối trần, dấu `/`)", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\src\\a.ts";

    await bamCmdK();

    expect(may.cauHoiDaGui[0]).toContain('"src/a.ts"');
  });

  it("★★★ tệp NGOÀI mọi thư mục workspace ⇒ báo RÀNH MẠCH, KHÔNG dựng câu hỏi", async () => {
    // `apBanVa` sẽ từ chối ở luật 2 dù model trả lời gì; nói ngay còn hơn để người dùng đợi hết một
    // lượt hỏi rồi mới nhận một câu từ chối chẳng liên quan gì tới điều họ vừa bấm.
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ngoai\\a.ts";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.thongBao.join(" ")).toContain("KHÔNG nằm trong thư mục workspace");
  });

  it("★★ số dòng vẫn 1-BASED và đúng đoạn đang chọn (không bị bản vá F3 làm lệch)", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\a.ts";

    await bamCmdK();

    expect(may.cauHoiDaGui[0]).toContain("từ dòng 5 đến dòng 7");
    expect(may.cauHoiDaGui[0]).toContain('"dongDau":5');
    expect(may.cauHoiDaGui[0]).toContain('"dongCuoi":7');
  });

  it("★★ không có đoạn chọn ⇒ báo và KHÔNG hỏi ô nhập", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\a.ts";
    may.chonRong = true;

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.thongBao.join(" ")).toContain("bôi đen");
  });

  it("★★ người dùng bấm Esc ở ô nhập ⇒ huỷ lặng lẽ, không câu hỏi nào được gửi", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\a.ts";
    may.yeuCauNguoiDung = undefined;

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.thongBao).toHaveLength(0);
  });
});

describe("Cmd+K — H1: hàng rào GỬI ở mức TỆP (review toàn nhánh 2026-08-30)", () => {
  /**
   * ★★★ Trước bản vá: `chaySuaDoanChon` chỉ kiểm "có đoạn chọn" và "tệp có trong workspace" — CHƯA
   * BAO GIỜ hỏi `duocPhepRoiMay`. Cùng một `.env` mà đường NGỮ CẢNH (`dungNguCanh`) bị chặn đúng,
   * còn đường CÂU HỎI của Cmd+K thì không — đây là ca đo ĐƯỜNG THỨ TƯ đó, đo KẾT CỤC (không phải
   * chỉ đo ý định): không một byte nào của đoạn chọn được gửi đi.
   */
  it("★★★ `.env` ⇒ KHÔNG dựng câu hỏi, KHÔNG một byte nào của đoạn chọn rời máy", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\.env";
    may.doanChon = "DATABASE_URL=postgres://nguoidung:MAT_KHAU_THAT@10.0.0.7:5432/db";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.cauHoiDaGui.join(" ")).not.toContain("MAT_KHAU_THAT");
    expect(may.thongBao.join(" ")).toContain("nhạy cảm");
  });

  it("★★★ khoá riêng SSH (`keys/id_rsa`) ⇒ KHÔNG dựng câu hỏi", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\keys\\id_rsa";
    may.doanChon = "-----BEGIN OPENSSH PRIVATE KEY-----\nMOC_THAN_KHOA\n-----END OPENSSH PRIVATE KEY-----";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.cauHoiDaGui.join(" ")).not.toContain("MOC_THAN_KHOA");
  });

  it("★★★ `.git/config` (token remote) ⇒ KHÔNG dựng câu hỏi", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\.git\\config";
    may.doanChon = "url = https://nguoidung:MOC_TOKEN@github.com/x/y.git";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(0);
    expect(may.cauHoiDaGui.join(" ")).not.toContain("MOC_TOKEN");
  });

  it("★★ NHÁNH KIA: tệp BÌNH THƯỜNG vẫn chạy Cmd+K được như cũ (hàng rào không chặn nhầm)", async () => {
    may.thuMucWs = ["C:\\ws"];
    may.tepDangMo = "C:\\ws\\src\\a.ts";
    may.doanChon = "let a = 1;";

    await bamCmdK();

    expect(may.cauHoiDaGui).toHaveLength(1);
    expect(may.cauHoiDaGui[0]).toContain("let a = 1;");
  });
});
