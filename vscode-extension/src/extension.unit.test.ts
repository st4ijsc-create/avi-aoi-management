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
  /**
   * ★★★ ĐỢT F / TASK 3 — instance THANH BÊN giả mà `BangChat.thanhBenDangMo()` trả về. `undefined`
   * mô phỏng "VSCode chưa từng resolve view thanh bên" (nhánh kia của hai lệnh nút "Chat mới"/"Lịch
   * sử") — lưới này đo ĐÚNG một thứ: extension.ts gọi phương thức nào trên instance nào, không đo
   * lại bản thân `chatMoi()`/`moLichSu()` (đã có lưới riêng ở `bangChat.unit.test.ts`).
   */
  thanhBenGia: undefined as undefined | { chatMoi: () => Promise<void>; moLichSu: () => Promise<void> },
  // ★★★ ĐỢT F / TASK 4 — phiên bản VSCode GIẢ mà `vscode.version` trả về; mỗi ca tự đặt để đo
  // `hoTroThanhBenPhu` phản ánh đúng vào lệnh `setContext` mà `activate()` gọi.
  phienBanVscode: "1.135.0",
  /** Mọi lệnh `commands.executeCommand(...)` mà `activate()` gọi — dùng để đo `setContext`. */
  executeCommandGoi: [] as unknown[][],
  /** Mọi lệnh `window.registerWebviewViewProvider(id, provider)` — dùng để đo B3 (cả hai view id
   *  phải được đăng ký, dùng CHUNG một instance provider). */
  dangKyViewProvider: [] as Array<{ id: string; provider: unknown }>,
  // ★★★ ĐỢT G / TASK G4 / B3 — mô phỏng `dangNhap()` (`mang/dangNhap.ts`) NÉM một lỗi cụ thể (không
  // chạm mạng thật). `undefined` ⇒ trả kết quả "ok" mặc định (không ca cũ nào trong tệp này gọi
  // lệnh `aviAiLocal.dangNhap`, xác nhận bằng grep trước khi thêm mock — an toàn cho chúng).
  dangNhapNem: undefined as unknown,
  /** Nút được "bấm" trên hộp thoại lỗi (`showErrorMessage`) — `undefined` mô phỏng đóng hộp thoại
   *  không chọn gì. */
  chonNutLoi: undefined as string | undefined,
  /** Mọi lần `showErrorMessage` được gọi — ghi lại (thông điệp, danh sách nút) để lưới đo cả hai. */
  loiDuaRa: [] as Array<{ thongDiep: string; nut: string[] }>,
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
    // ★★★ ĐỢT F / TASK 4 — `hoTroThanhBenPhu(vscode.version)` đọc trường này trong `activate()`.
    get version() {
      return may.phienBanVscode;
    },
    commands: {
      registerCommand: (id: string, h: () => unknown) => {
        may.lenh.set(id, h);
        return { dispose: () => undefined };
      },
      // ★★★ ĐỢT F / TASK 4 / B2 — `activate()` gọi `executeCommand("setContext", ...)` để đặt
      // context key quyết định vị trí (activitybar/secondarySidebar). Ghi lại nguyên văn tham số.
      executeCommand: (...args: unknown[]) => {
        may.executeCommandGoi.push(args);
        return Promise.resolve(undefined);
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
      // ★★★ ĐỢT G / TASK G4 / B3 — NHẬN thêm danh sách nút (chữ ký thật của `showErrorMessage` là
      // `(message, ...items)`), GHI LẠI để lưới đo cả thông điệp lẫn nút được đưa ra, và TRẢ VỀ nút
      // mà ca lưới đang mô phỏng "đã bấm" (`may.chonNutLoi`, mặc định `undefined` — đóng hộp thoại).
      showErrorMessage: (s: string, ...nut: string[]) => {
        may.thongBao.push(s);
        may.loiDuaRa.push({ thongDiep: s, nut });
        return Promise.resolve(may.chonNutLoi);
      },
      // ★★★ THANH BÊN — `activate()` nay đăng ký thêm view provider cho khung chat trong thanh
      // hoạt động (xem `extension.ts`). Lưới này đo đường CMD+K, không đo đường thanh bên, nên chỉ
      // cần một bản giả TỐI THIỂU không ném lỗi — không có gì để `resolveWebviewView` gọi tới vì
      // không ca nào ở đây làm view hiện lên. ★★★ ĐỢT F / TASK 4 / B3 — ghi lại (id, provider) để
      // describe "TASK 4" dưới đây đo CẢ HAI view id được đăng ký, dùng CHUNG một instance.
      registerWebviewViewProvider: (id: string, provider: unknown) => {
        may.dangKyViewProvider.push({ id, provider });
        return { dispose: () => undefined };
      },
    },
    workspace,
  };
});

/**
 * ★★★ ĐỢT G / TASK G4 / B3 — mô phỏng `mang/dangNhap.ts` (I/O đăng nhập THẬT, gọi `fetch`). Không
 * ca nào trong tệp này trước đây gọi lệnh `aviAiLocal.dangNhap` (grep xác nhận), nên mock TOÀN PHẦN
 * ở đây an toàn — không có hành vi cũ nào để giữ nguyên.
 */
vi.mock("./mang/dangNhap", () => ({
  dangNhap: async (_serverUrl: string, ten: string) => {
    if (may.dangNhapNem) throw may.dangNhapNem;
    return { ket: { loai: "ok", ten }, cookie: "cookie-gia" };
  },
}));

// Bảng chat + kho đề xuất bị thay: lưới này đo ĐÚNG một thứ — chuỗi câu hỏi đi ra khỏi Cmd+K.
vi.mock("./ui/bangChat", () => ({
  BangChat: {
    moHoacHien: () => ({
      guiCauHoiTuLenh: (c: string) => {
        may.cauHoiDaGui.push(c);
      },
    }),
    // ★★★ ĐỢT F / TASK 3 — bản giả tối thiểu cho hai lệnh nút "Chat mới"/"Lịch sử".
    thanhBenDangMo: () => may.thanhBenGia,
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
import { MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU } from "./ui/bangChatView";
import { KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU } from "./loi/thanhBenPhu";

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
  may.thanhBenGia = undefined;
  may.phienBanVscode = "1.135.0";
  may.executeCommandGoi = [];
  may.dangKyViewProvider = [];
  may.dangNhapNem = undefined;
  may.chonNutLoi = undefined;
  may.loiDuaRa = [];
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

/**
 * ★★★ ĐỢT F / TASK 3 — hai lệnh nút "Chat mới"/"Lịch sử" ở `view/title` (xem `package.json`,
 * `thanhBen.unit.test.ts` canh phần đăng ký-đúng-tên bằng chuỗi). Lưới ở ĐÂY đo phần chuỗi đó
 * KHÔNG canh được: extension.ts phải gọi ĐÚNG PHƯƠNG THỨC trên ĐÚNG instance (`BangChat.thanhBenDangMo()`),
 * không phải một luồng nào khác — và NHÁNH KIA khi chưa có view thanh bên nào mở.
 */
describe("ĐỢT F / TASK 3 — lệnh 'aviAiLocal.chatMoi' / 'aviAiLocal.lichSu'", () => {
  it("★★★ aviAiLocal.chatMoi gọi ĐÚNG BangChat.thanhBenDangMo().chatMoi()", async () => {
    const chatMoi = vi.fn(async () => undefined);
    may.thanhBenGia = { chatMoi, moLichSu: vi.fn(async () => undefined) };
    activate({ subscriptions: [], secrets: {} } as never);

    expect(may.lenh.has("aviAiLocal.chatMoi")).toBe(true);
    await may.lenh.get("aviAiLocal.chatMoi")!();

    expect(chatMoi).toHaveBeenCalledTimes(1);
    expect(may.thanhBenGia.moLichSu).not.toHaveBeenCalled();
  });

  it("★★★ aviAiLocal.lichSu gọi ĐÚNG BangChat.thanhBenDangMo().moLichSu()", async () => {
    const moLichSu = vi.fn(async () => undefined);
    may.thanhBenGia = { chatMoi: vi.fn(async () => undefined), moLichSu };
    activate({ subscriptions: [], secrets: {} } as never);

    expect(may.lenh.has("aviAiLocal.lichSu")).toBe(true);
    await may.lenh.get("aviAiLocal.lichSu")!();

    expect(moLichSu).toHaveBeenCalledTimes(1);
    expect(may.thanhBenGia.chatMoi).not.toHaveBeenCalled();
  });

  it("★ NHÁNH KIA — CHƯA có view thanh bên nào mở (thanhBenDangMo() trả undefined) ⇒ bấm nút KHÔNG ném lỗi", async () => {
    // `?.` short-circuit trả THẲNG `undefined` (KHÔNG phải một Promise) khi chưa có instance —
    // đo đúng điều đó thay vì `.resolves` (chỉ hợp khi tay cầm THẬT SỰ là một Promise).
    may.thanhBenGia = undefined;
    activate({ subscriptions: [], secrets: {} } as never);

    expect(() => may.lenh.get("aviAiLocal.chatMoi")!()).not.toThrow();
    expect(() => may.lenh.get("aviAiLocal.lichSu")!()).not.toThrow();
  });
});

/**
 * ★★★ ĐỢT F / TASK 4 — `activate()` phải (1) đặt ĐÚNG context key bằng ĐÚNG giá trị boolean tuỳ
 * phiên bản VSCode (B2), và (2) đăng ký CẢ HAI view id, dùng CHUNG một instance provider (B3).
 * `thanhBen.unit.test.ts` đo phần MANIFEST (chuỗi trong package.json); lưới ở ĐÂY đo phần MÃ chạy
 * (đúng lệnh, đúng tham số, đúng số lần) — hai lớp không thể lẫn vào nhau.
 */
describe("ĐỢT F / TASK 4 — activate() đặt context key CẢ HAI view id thanh bên", () => {
  it("★★★ VSCode 1.135.0 (hỗ trợ thanh bên phụ) ⇒ setContext(khoá, false) — KHÔNG bắt lùi về activitybar", () => {
    may.phienBanVscode = "1.135.0";
    activate({ subscriptions: [], secrets: {} } as never);

    const goi = may.executeCommandGoi.find((a) => a[0] === "setContext");
    expect(goi, "activate() không gọi executeCommand('setContext', ...)").toBeDefined();
    expect(goi).toEqual(["setContext", KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU, false]);
  });

  it("★★★ NHÁNH KIA — VSCode 1.50.0 (dưới ngưỡng 1.106) ⇒ setContext(khoá, true) — BẮT LÙI về activitybar", () => {
    may.phienBanVscode = "1.50.0";
    activate({ subscriptions: [], secrets: {} } as never);

    const goi = may.executeCommandGoi.find((a) => a[0] === "setContext");
    expect(goi).toEqual(["setContext", KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU, true]);
  });

  it("★★★ CẢ HAI view id (activitybar + secondarySidebar) đều được registerWebviewViewProvider", () => {
    activate({ subscriptions: [], secrets: {} } as never);

    const ds = may.dangKyViewProvider.map((d) => d.id);
    expect(ds).toContain(MA_VIEW_THANH_BEN);
    expect(ds).toContain(MA_VIEW_THANH_BEN_PHU);
    expect(ds).toHaveLength(2); // đúng hai lần — không đăng ký thừa, không thiếu.
  });

  it("★★★ dùng CHUNG một instance provider cho cả hai view id — KHÔNG chép lớp/instance thứ hai", () => {
    activate({ subscriptions: [], secrets: {} } as never);

    expect(may.dangKyViewProvider).toHaveLength(2);
    const [a, b] = may.dangKyViewProvider;
    expect(a!.provider).toBe(b!.provider); // NGUYÊN VĂN cùng một object, không chỉ "cùng hình dạng".
  });
});

/** ★★★ ĐỢT G / TASK G4 / B2 — lệnh đổi nhanh địa chỉ máy chủ. */
describe("ĐỢT G / TASK G4 / B2 — lệnh 'aviAiLocal.doiMayChu'", () => {
  it("★★★ đã đăng ký, và khi chạy thì mở ĐÚNG Settings đã lọc tới aviAiLocal.serverUrl", async () => {
    activate({ subscriptions: [], secrets: {} } as never);

    expect(may.lenh.has("aviAiLocal.doiMayChu")).toBe(true);
    await may.lenh.get("aviAiLocal.doiMayChu")!();

    expect(may.executeCommandGoi).toContainEqual(["workbench.action.openSettings", "aviAiLocal.serverUrl"]);
  });
});

/**
 * ★★★ ĐỢT G / TASK G4 / B3 — LỖI PHẢI CHỈ ĐƯỜNG SỬA ở đường ĐĂNG NHẬP: exception từ `dangNhap()`
 * (`mang/dangNhap.ts`) là đường THỨ HAI có thể gặp "server đổi IP" TRƯỚC KHI có cookie — cùng vị từ
 * THUẦN `laLoiKhongNoiDuocMayChu` mà `bangChat.ts` dùng cho lỗi giữa lượt hỏi (lưới riêng của vị từ
 * ở `loi/loiKetNoiMayChu.unit.test.ts`; nhóm ca dưới đây đo phần CHỈ `extension.ts` mới có: đúng
 * NÚT nào được đưa ra và đúng LỆNH nào chạy khi bấm nút đó).
 */
function loiKhongNoiDuocMayChuGia(): Error {
  const loi = new TypeError("fetch failed");
  (loi as unknown as { cause: unknown }).cause = Object.assign(new Error("mô phỏng"), { code: "ECONNREFUSED" });
  return loi;
}

describe("ĐỢT G / TASK G4 / B3 — đăng nhập gặp lỗi mạng ⇒ chỉ đường sửa", () => {
  it("★★★ lỗi mạng ⇒ hộp thoại có nút 'Mở Settings'; bấm nút ⇒ mở đúng aviAiLocal.serverUrl", async () => {
    may.dangNhapNem = loiKhongNoiDuocMayChuGia();
    may.chonNutLoi = "Mở Settings";
    activate({ subscriptions: [], secrets: {} } as never);

    await may.lenh.get("aviAiLocal.dangNhap")!();

    const loi = may.loiDuaRa.at(-1);
    expect(loi, JSON.stringify(may.loiDuaRa)).toBeDefined();
    expect(loi!.nut).toContain("Mở Settings");
    expect(loi!.thongDiep).toContain("http://localhost:3000");
    expect(may.executeCommandGoi).toContainEqual(["workbench.action.openSettings", "aviAiLocal.serverUrl"]);
  });

  it("★★★ NHÁNH KIA — lỗi KHÔNG PHẢI lỗi mạng ⇒ KHÔNG nút 'Mở Settings', KHÔNG mở Settings", async () => {
    may.dangNhapNem = new Error("lỗi ngoài dự tính — không phải lỗi mạng");
    activate({ subscriptions: [], secrets: {} } as never);

    await may.lenh.get("aviAiLocal.dangNhap")!();

    const loi = may.loiDuaRa.at(-1);
    expect(loi, JSON.stringify(may.loiDuaRa)).toBeDefined();
    expect(loi!.nut).toEqual([]);
    expect(may.executeCommandGoi.some((a) => a[0] === "workbench.action.openSettings")).toBe(false);
  });
});
