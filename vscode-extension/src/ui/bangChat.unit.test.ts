/**
 * LƯỚI cho hai hàng rào của `ui/bangChat.ts` mà không lưới thuần nào với tới được:
 *   · **Minor** — `quenDeXuat` phải xoá `nhanNguonHienTai` VÔ ĐIỀU KIỆN (bản cũ `return` sớm khi
 *     không có `actionId`, bỏ lại nhãn — tức bỏ lại CHẾ ĐỘ — của lượt trước);
 *   · **I-5** — không xác định được chế độ ⇒ **từ chối cả lượt hỏi**, để không thẻ duyệt nào được
 *     vẽ ra từ một chế độ ĐOÁN.
 *
 * ⚠ Bản giả `vscode` ở đây cố ý TỐI THIỂU: chỉ đủ để dựng bảng và bơm tin nhắn webview. Mọi thứ
 *   nặng hơn (`hoi` đi tới mạng, `apBanVa`) đã có lưới riêng — dựng thêm ở đây chỉ đẻ ra một bản
 *   mô phỏng thứ hai để rồi trôi khỏi bản kia.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const may = vi.hoisted(() => ({
  /** Hàm nhận tin nhắn từ webview mà `BangChat` đăng ký. */
  nhanTin: undefined as undefined | ((m: Record<string, unknown>) => void),
  /** Hàm dọn mà `BangChat` đăng ký (dùng để reset trạng thái tĩnh giữa các ca). */
  don: undefined as undefined | (() => void),
  daGui: [] as Array<Record<string, unknown>>,
  cookie: undefined as string | undefined,
  thuMucWorkspace: [] as string[],
  /**
   * ★★★ H3 (review 2026-08-30) — HÀNG ĐỢI các "lượt gọi SSE" kế tiếp, mỗi phần tử là một hàm nhận
   * `dv` (đúng tham số `moDongSse` thật) và trả `{hong}` sau khi bắn token/done qua `dv.nhan`. Rỗng
   * ⇒ rơi về hành vi TREO mặc định (giữ nguyên cho hai nhóm ca cũ bên dưới, không đổi hành vi của
   * chúng). Cho phép lưới H3 mô phỏng NHIỀU vòng (model xin đọc ở vòng 1, trả lời ở vòng 2) mà
   * không cần một stream thật.
   */
  hangDoiSse: [] as Array<
    (dv: { nhan: (sk: Record<string, unknown>) => void; tinHieu?: AbortSignal }) => Promise<{ hong: string[] }>
  >,
  /** ★★★ H3 — thân POST (`dungYeuCauStream(...)`) của TỪNG lượt gọi SSE, theo đúng thứ tự vòng. */
  thanGoi: [] as Array<Record<string, unknown>>,
  // ★★★ ĐỢT F / TASK 1 — mô phỏng CẶP nơi `extension.ts` ghi CÙNG LÚC lúc đăng nhập/đăng xuất
  // (`context.globalState`, tên tài khoản — KHÔNG phải bí mật, `may.cookie` ở trên đã đóng vai
  // SecretStorage). Bản giả `commands.executeCommand` bên dưới tự ĐỔI hai biến này để mô phỏng
  // ĐÚNG những gì lệnh `aviAiLocal.dangNhap`/`aviAiLocal.dangXuat` thật làm SAU KHI chạy xong —
  // lưới này đo bangChat.ts ĐỌC LẠI trạng thái sau khi lệnh xong, không đo bản thân extension.ts.
  globalState: {} as Record<string, unknown>,
  /** Lệnh nào đã được `vscode.commands.executeCommand` gọi, ĐÚNG THỨ TỰ. */
  lenhGoi: [] as string[],
  /** Đăng nhập lần tới có "thành công" không (huỷ/sai mật khẩu ⇒ false, KHÔNG đổi cookie/tên). */
  dangNhapThanhCong: true,
  /** Tên tài khoản mà một lượt đăng nhập THÀNH CÔNG sẽ đặt vào `globalState`. */
  tenSauDangNhap: "nguoi_dung_thu",
  // ★★★ ĐỢT F / TASK 2 — túi giả cho `context.workspaceState` (KHÁC `globalState`: đây là nơi
  // `khoHoiThoai.ts` lưu hội thoại, xem docblock `KHOA_HOI_THOAI`). Cùng khuôn Map-giả với
  // `globalState` ở trên, chỉ khác TÊN để hai thứ không lẫn vào nhau trong lưới.
  workspaceState: {} as Record<string, unknown>,
  /** ★★★ Ép `workspaceState.update` giả ném lỗi — xem docblock ở chỗ dùng trong `moBang()`. */
  ghiWorkspaceStateThatBai: false,
  // ★★★ ĐỢT F / TASK 3 — bản giả `showQuickPick`. `undefined` (mặc định) mô phỏng người dùng bấm
  // Esc/bấm ra ngoài (huỷ chọn); một số ⇒ CHỈ SỐ (sau khi đã sắp theo `thoiDiem` MỚI→CŨ, đúng thứ
  // tự `moLichSu()` đưa cho `showQuickPick`) của mục được "chọn".
  quickPickChonChiSo: undefined as number | undefined,
  /** Các mục ĐÃ ĐƯA cho `showQuickPick` ở lần gọi GẦN NHẤT — để lưới đo nội dung liệt kê. */
  quickPickMucGanNhat: [] as Array<{ label: string; description?: string }>,
  /** Số lần `showQuickPick` được gọi — dùng để khẳng định "kho rỗng ⇒ KHÔNG mở QuickPick". */
  quickPickSoLanGoi: 0,
  /** Thông báo đã gửi qua `showInformationMessage`, ĐÚNG THỨ TỰ. */
  thongBaoInfo: [] as string[],
  /**
   * ★★★ ĐỢT G / TASK G1 / B1 — đáp ứng giả cho `goiTruyVanTrpc(..., "auth.me")`, dùng để kiểm
   * TRA THẬT cookie còn hiệu lực hay không (khác `repoWorkspace.listProjects`, luôn trả `{projects:
   * []}` bất kể đầu vào — xem mock `../mang/trpc` bên dưới). Mặc định TRUTHY (một hồ sơ người dùng
   * giả) để MỌI ca cũ trong tệp này (đa số bắt đầu với `may.cookie = "cookie-gia"` ở `beforeEach`)
   * tiếp tục coi cookie là HỢP LỆ mà không phải sửa lại — chỉ nhóm ca B1 mới đặt nó về `null` để mô
   * phỏng "auth.me RÀNH MẠCH nói phiên đã hết" (200 kèm `json:null`, KHÔNG phải một lỗi mạng).
   */
  trpcAuthMeKetQua: { id: 1, name: "nguoi_dung_thu" } as unknown,
  /** ★★★ B1 — ép mock `auth.me` NÉM lỗi mạng (thay vì trả `null`) — mô phỏng "KHÔNG BIẾT" (máy chủ
   *  không nối được), khác hẳn "BIẾT LÀ SAI" (`trpcAuthMeKetQua = null`). Cờ riêng thay vì gán một
   *  Promise reject vào `trpcAuthMeKetQua` — tránh cảnh báo unhandled-rejection nếu không ai await
   *  nó kịp trong cùng tick. */
  trpcAuthMeLoiMang: false,
}));

/**
 * ★★★ TASK 6/D.1 (LỖI 3) — mô phỏng ĐÚNG hành vi `fetch`/undici thật đo được ở Task 6: huỷ GIỮA
 * LÚC ĐANG ĐỌC THÂN SSE khiến promise reject bằng CHÍNH `signal.reason` — khi `dungVongHienTai()`
 * gọi `abort(lyDo)` với một LÝ DO TUỲ CHỈNH (chuỗi), `reason` đó LÀ MỘT CHUỖI TRẦN, không phải
 * `Error`/`AbortError`. Promise KHÔNG BAO GIỜ tự resolve — treo y hệt một luồng SSE thật đang bay,
 * chỉ thoát khi tín hiệu huỷ bắn (đúng thời điểm đang "ĐỌC THÂN", không phải TRƯỚC KHI CÓ RESPONSE
 * như kịch bản Task 4 đã đo). ★★★ H3 — `may.hangDoiSse` cho phép GHI ĐÈ hành vi này cho MỘT vài
 * lượt gọi kế tiếp (dùng cho lưới nhiều vòng); rỗng thì vẫn treo y hệt bản cũ.
 */
vi.mock("../mang/dongSse", () => ({
  moDongSse: (dv: { than: Record<string, unknown>; tinHieu?: AbortSignal; nhan: (sk: Record<string, unknown>) => void }) => {
    may.thanGoi.push(dv.than);
    const ke = may.hangDoiSse.shift();
    if (ke) return ke(dv);
    return new Promise((_resolve, reject) => {
      dv.tinHieu?.addEventListener("abort", () => reject(dv.tinHieu!.reason), { once: true });
    });
  },
}));

/**
 * ★★★ H3(a) — lưới cho vòng ≥2 cần `chayToolCucBo` trả lời NGAY (không chạm `vscode`/đĩa thật, mà
 * bản giả `vscode` ở đầu tệp này cố ý TỐI THIỂU không có `workspace.findFiles`). Kết quả ở đây
 * không mang bí mật nào — chỉ cần đủ để vòng lặp tác nhân đi tiếp sang vòng kế.
 */
vi.mock("../mang/toolCucBo", () => ({
  chayToolCucBo: async () => ({ ok: true, ketQua: "--- TỆP a.ts ---\nnội dung tệp giả" }),
  danhSachTepGoiY: async () => [],
}));

/**
 * ★★★ ĐỢT F / TASK 1 — không mock được TRƯỚC (không tệp lưới nào ở đây từng bơm "san_sang", nên
 * `napDuAn()` chưa từng chạy trong lưới này). Thêm ca "đã đăng nhập" cho `trang_thai_dang_nhap`
 * (cookie CÓ giá trị) sẽ kéo `napDuAn()` gọi THẬT `goiTruyVanTrpc` → `fetch` mạng thật nếu không
 * chặn ở đây — đúng lớp "lưới không hermetic" mà `../mang/dongSse` ở trên đã né cho SSE. Trả danh
 * sách RỖNG: đủ để `napDuAn` không ném, không liên quan gì tới trục đo của nhóm ca đăng nhập.
 */
/**
 * ★★★ ĐỢT G / TASK G1 / B1 — MỞ RỘNG mock để phân biệt hai lời gọi `goiTruyVanTrpc` khác nhau:
 * `repoWorkspace.listProjects` (napDuAn, không liên quan trục B1) vẫn trả `{projects: []}` như cũ;
 * `auth.me` (kiểm cookie còn hiệu lực, B1 mới) trả `may.trpcAuthMeKetQua` — TRUTHY mặc định (cookie
 * hợp lệ), các ca B1 tự đặt về `null` để mô phỏng phiên đã hết mà KHÔNG phải một lỗi mạng.
 */
vi.mock("../mang/trpc", () => ({
  goiTruyVanTrpc: async (_serverUrl: string, _cookie: string, ten: string) => {
    if (ten !== "auth.me") return { projects: [] };
    if (may.trpcAuthMeLoiMang) throw new Error("ECONNREFUSED — máy chủ không nối được");
    return may.trpcAuthMeKetQua;
  },
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }) },
  // ★★★ ĐỢT F / TASK 1 — bản giả TỐI THIỂU của `aviAiLocal.dangNhap`/`aviAiLocal.dangXuat`. Lưới
  // này KHÔNG đo `extension.ts` (đã có lưới riêng ở `extension.unit.test.ts`) — nó chỉ cần một
  // hàm mô phỏng ĐÚNG hai điều đo được ở mã thật: (1) `executeCommand` trả về ĐÚNG promise của cả
  // luồng lệnh (không resolve sớm), (2) đăng nhập thành công ghi CẢ cookie LẪN tên tài khoản, đăng
  // xuất xoá CẢ HAI.
  commands: {
    executeCommand: async (id: string) => {
      may.lenhGoi.push(id);
      if (id === "aviAiLocal.dangNhap" && may.dangNhapThanhCong) {
        may.cookie = "cookie-gia";
        may.globalState["aviAiLocal.tenTaiKhoan"] = may.tenSauDangNhap;
      } else if (id === "aviAiLocal.dangXuat") {
        may.cookie = undefined;
        delete may.globalState["aviAiLocal.tenTaiKhoan"];
      }
      return undefined;
    },
  },
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
    activeTextEditor: undefined,
    // ★★★ ĐỢT F / TASK 3 — "Lịch sử" (`moLichSu()`). `undefined` khi `may.quickPickChonChiSo`
    // không đặt ⇒ mô phỏng Esc/bấm ra ngoài, KHÔNG chọn gì.
    showQuickPick: async (items: Array<{ label: string; description?: string }>) => {
      may.quickPickSoLanGoi++;
      may.quickPickMucGanNhat = items;
      return may.quickPickChonChiSo === undefined ? undefined : items[may.quickPickChonChiSo];
    },
    showInformationMessage: (s: string) => {
      may.thongBaoInfo.push(s);
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    get workspaceFolders() {
      return may.thuMucWorkspace.map((p) => ({ uri: { fsPath: p } }));
    },
    getConfiguration: () => ({ get: <T>(_k: string, mm: T) => mm }),
  },
}));

import { BangChat } from "./bangChat";
import { dungVanBanDayGiaoThucDoc, nhacLaiCuoiCauHoi } from "../loi/dayGiaoThucDoc";
import { LoiHttp } from "../loi/loiHttp";
import { KHOA_HOI_THOAI, type HoiThoai } from "../loi/khoHoiThoai";

/** Kho đề xuất giả — chỉ cần `quen()` để `quenDeXuat` gọi được. */
const khoGia = { quen: () => undefined, moDiff: async () => undefined, moDiffCucBo: async () => undefined };

/**
 * ★★★ ĐỢT F / TASK 3 — RÚT RA từ `moBang()` để `moBangThanhBen()` (khung THANH BÊN, `choView()`)
 * dùng CHUNG đúng một bản giả `context` — không chép một bản thứ hai rồi để hai bản trôi khỏi nhau.
 */
function dungContextGia() {
  return {
    secrets: {
      get: async () => may.cookie,
      delete: async () => {
        may.cookie = undefined;
      },
    },
    // ★★★ ĐỢT F / TASK 1 — `globalState` giả, đọc/ghi đúng cùng túi `may.globalState` mà
    // `commands.executeCommand` giả ở trên đổi. `get` PHẢI đồng bộ (đúng chữ ký `Memento.get`
    // thật) — `trangThaiDangNhap()` trong `bangChat.ts` không `await` nó.
    globalState: {
      get: (k: string, mm: unknown) => (k in may.globalState ? may.globalState[k] : mm),
      update: async (k: string, v: unknown) => {
        if (v === undefined) delete may.globalState[k];
        else may.globalState[k] = v;
      },
    },
    // ★★★ ĐỢT F / TASK 2 — `workspaceState` giả, ĐÚNG chữ ký `Memento` thật (`get` ĐỒNG BỘ,
    // `update` trả Promise) mà `khoHoiThoaiTho()` trong `bangChat.ts` bọc lại thành `KhoLuuTruTho`.
    workspaceState: {
      get: (k: string, mm: unknown) => (k in may.workspaceState ? may.workspaceState[k] : mm),
      update: async (k: string, v: unknown) => {
        // ★★★ NHÁNH KIA của bản vá "lỗi lưu không được làm rớt câu trả lời" — cho phép lưới ép
        // `update` NÉM LỖI (đĩa đầy/hỏng…) để đo `bangChat.ts` có nuốt lỗi ĐÚNG chỗ hay không.
        if (may.ghiWorkspaceStateThatBai) throw new Error("giả lập: ghi workspaceState thất bại");
        if (v === undefined) delete may.workspaceState[k];
        else may.workspaceState[k] = v;
      },
    },
  };
}

function moBang(): Record<string, unknown> {
  BangChat.moHoacHien(dungContextGia() as never, khoGia as never);
  // Instance nằm ở field tĩnh `hienTai` — lưới này cố ý soi TRẠNG THÁI RIÊNG, vì thứ cần đo chính
  // là một mảnh trạng thái riêng bị bỏ sót.
  return (BangChat as unknown as { hienTai: Record<string, unknown> }).hienTai;
}

/**
 * ★★★ ĐỢT F / TASK 3 — mở khung THANH BÊN (`choView`, đường MỚI dùng bởi hai nút "Chat mới"/"Lịch
 * sử") thay vì bảng NỔI (`moHoacHien`). `WebviewView` giả CHỈ cần đúng bề mặt `VatChuaChat` đòi hỏi
 * (`webview` + `onDidDispose`) cộng `show` (tuỳ chọn, `lamHienRo` dùng tới) — cùng khuôn TỐI THIỂU
 * với bản giả `createWebviewPanel` ở trên.
 */
function moBangThanhBen(): Record<string, unknown> {
  const webviewViewGia = {
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
    show: () => undefined,
  };
  BangChat.choView(webviewViewGia as never, dungContextGia() as never, khoGia as never);
  return (BangChat as unknown as { thanhBenHienTai: Record<string, unknown> }).thanhBenHienTai;
}

/**
 * ★★★ RÚT RA module-scope (trước chỉ cục bộ trong describe "ĐỢT F / TASK 2") để nhóm ca Task 3
 * ("Chat mới"/"Lịch sử") dùng CHUNG — một lượt hỏi ĐƠN GIẢN, không xin đọc gì thêm ⇒ dừng sau ĐÚNG
 * một vòng SSE (`buocKeTiep` trả "khong_con_tool" vì `traLoiCuoi` không mang khối ```avi-tool```).
 */
function hangDoiMotVongDonGian(traLoi: string): typeof may.hangDoiSse {
  return [
    async (dv) => {
      dv.nhan({ type: "token", token: traLoi });
      dv.nhan({ type: "done" });
      return { hong: [] };
    },
  ];
}

beforeEach(() => {
  may.don?.();
  may.nhanTin = undefined;
  may.don = undefined;
  may.daGui = [];
  may.cookie = "cookie-gia";
  may.thuMucWorkspace = [];
  may.hangDoiSse = [];
  may.thanGoi = [];
  may.globalState = {};
  may.workspaceState = {};
  may.lenhGoi = [];
  may.dangNhapThanhCong = true;
  may.tenSauDangNhap = "nguoi_dung_thu";
  may.ghiWorkspaceStateThatBai = false;
  may.quickPickChonChiSo = undefined;
  may.quickPickMucGanNhat = [];
  may.quickPickSoLanGoi = 0;
  may.thongBaoInfo = [];
  may.trpcAuthMeKetQua = { id: 1, name: "nguoi_dung_thu" };
  may.trpcAuthMeLoiMang = false;
});

describe("quenDeXuat — xoá trạng thái VÔ ĐIỀU KIỆN (Minor)", () => {
  it("★★★ không còn đề xuất nào nhưng nhãn nguồn của lượt trước vẫn sót ⇒ PHẢI bị xoá", () => {
    const bang = moBang();
    // Trạng thái sót: nhãn (mang chữ "LOCAL ·", tức mang CHẾ ĐỘ) còn, đề xuất thì không.
    bang.nhanNguonHienTai = "LOCAL · C:\\ws";
    expect(bang.deXuatHienTai).toBeUndefined();
    expect(bang.deXuatCucBoHienTai).toBeUndefined();

    // Đổi dự án ⇒ `quenDeXuat`. Bản cũ `return` ngay vì không có `actionId` ⇒ nhãn sống sót.
    may.nhanTin?.({ loai: "doi_du_an", duAnId: "local:C:\\khac" });

    expect(bang.nhanNguonHienTai).toBeUndefined();
  });

  it("★★ không có đề xuất ⇒ KHÔNG bắn tin ẩn thẻ / thông báo (đừng làm ồn cho một việc không xảy ra)", () => {
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "doi_du_an", duAnId: "local:C:\\khac" });
    expect(may.daGui).toEqual([]);
  });
});

describe("hoi — I-5: không xác định được chế độ ⇒ TỪ CHỐI, không đoán", () => {
  it("★★★ danh sách dự án RỖNG (chưa nạp xong) ⇒ báo lỗi và KHÔNG hỏi", async () => {
    /**
     * ★★★ Bản cũ suy ra `{loai:"local", nhan:"workspace"}` từ một danh sách RỖNG rồi chạy tiếp cả
     * lượt hỏi — nghĩa là một lượt trả lời có thể đẻ ra thẻ "Ghi vào workspace" cho một chế độ chưa
     * ai xác định. Ở một cửa ghi đĩa, "không biết" phải dừng lại.
     */
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "hoi", cauHoi: "sửa a.ts giúp tôi" });
    // `hoi` là async (đọc cookie trước) — nhường vài nhịp cho chuỗi promise chạy hết.
    await new Promise((r) => setTimeout(r, 0));

    const loi = may.daGui.filter((m) => m.loai === "loi");
    expect(loi).toHaveLength(1);
    expect(String(loi[0].thongDiep)).toContain("Chưa xác định được dự án");
    // Và không có khung trả lời nào được mở ra.
    expect(may.daGui.some((m) => m.loai === "hoan_tat")).toBe(false);
  });
});

describe("hoi — TASK 6/D.1 (LỖI 3): nút Dừng phải khai 'đã dừng', KHÔNG PHẢI 'lỗi rỗng'", () => {
  it("★★★ huỷ GIỮA LÚC ĐANG ĐỌC THÂN SSE (reject bằng CHUỖI TRẦN, không phải AbortError) ⇒ báo 'đã dừng', KHÔNG báo lỗi", async () => {
    /**
     * ★★★ Đo Task 6 (`t6-chan-doan-dung.json`): bấm Dừng trong lúc `moDongSse` ĐANG đọc thân SSE
     * khiến undici reject bằng `signal.reason` — MỘT CHUỖI TRẦN (`"nguoi_dung_dung"`), không phải
     * `Error`. Bản cũ kiểm `(e as Error).name === "AbortError"` ⇒ luôn `undefined` trên một chuỗi
     * ⇒ rơi xuống nhánh lỗi chung với `thongDiep: undefined` — bong bóng "Lỗi" HIỆN RỖNG cho một
     * lượt người dùng CHỦ Ý dừng. Ca này tái hiện ĐÚNG hình dạng đó (mock ở đầu tệp).
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];

    may.nhanTin?.({ loai: "hoi", cauHoi: "đọc giúp tôi tệp a.ts" });
    // Nhường nhịp cho `hoi()` chạy qua `await` đọc cookie rồi tới `await moDongSse(...)` (mocked ở
    // đầu tệp — ĐANG TREO chờ tín hiệu huỷ, đúng mô phỏng "đang đọc thân SSE").
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Bấm Dừng — CHÍNH `dungVongHienTai()` gọi `abort(LY_DO_NGUOI_DUNG_DUNG)`, đồng bộ khiến
    // listener trong mock `reject(signal.reason)` với ĐÚNG chuỗi đó.
    may.nhanTin?.({ loai: "dung_hoi" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const loi = may.daGui.filter((m) => m.loai === "loi");
    expect(loi, `KHÔNG được có bong bóng lỗi cho một lượt DỪNG có chủ ý; thực tế: ${JSON.stringify(may.daGui)}`).toEqual(
      [],
    );

    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.some((m) => String(m.thongDiep).includes("Đã dừng"))).toBe(true);
    // `hoan_tat` PHẢI tới để webview ẩn nút Dừng — không tín hiệu nào khác làm việc đó.
    expect(may.daGui.some((m) => m.loai === "hoan_tat")).toBe(true);
  });

  it("★★ huỷ NGẦM (câu hỏi MỚI đè lên câu cũ, KHÔNG kèm lý do) ⇒ vẫn im lặng — NHÁNH KIA không bị vá nhầm", () => {
    /**
     * ★★★ KIỂM NHÁNH KIA của bản vá LỖI 3: nguồn sự thật đổi từ "hình dạng của `e`" sang
     * "`dieuKhien.signal.aborted`" — phải xác nhận nhánh HUỶ NGẦM (một câu hỏi mới tự `abort()`
     * KHÔNG kèm lý do, xem đầu `hoi()`) vẫn im lặng như hành vi cũ, KHÔNG bỗng dưng hiện "đã dừng"
     * cho một lượt người dùng không hề bấm Dừng.
     *
     * ⚠ Ca này KHÔNG cần đợi bất kỳ điều gì huỷ giữa lúc SSE đang treo — `hoi()` tự `abort()` NGAY
     *   ĐẦU của chính nó cho `this.huy` (bộ điều khiển của lượt TRƯỚC, nếu có). Gọi `hoi()` hai lần
     *   liên tiếp mà không đợi lần đầu xong là đủ để kích hoạt đúng nhánh này — synchronous, không
     *   cần mock SSE treo.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];

    may.nhanTin?.({ loai: "hoi", cauHoi: "câu đầu tiên" });
    // Câu hỏi THỨ HAI đè lên ngay lập tức — `this.huy?.abort()` (không lý do) huỷ bộ điều khiển của
    // câu đầu TRƯỚC khi nó kịp nhận được response nào.
    may.nhanTin?.({ loai: "hoi", cauHoi: "câu thứ hai" });

    // KHÔNG assert bất đồng bộ ở đây: ca này chỉ cần xác nhận KHÔNG có bong bóng "đã dừng"/"lỗi"
    // lạc vào giữa — hai điều đó chỉ có thể tới từ nhánh bị huỷ NGẦM nếu bản vá sai hướng.
    expect(may.daGui.filter((m) => m.loai === "loi")).toEqual([]);
    expect(may.daGui.filter((m) => m.loai === "thong_bao" && String(m.thongDiep).includes("Đã dừng"))).toEqual([]);
  });
});

describe("hoi — H3(a) (review toàn nhánh 2026-08-30): vòng ≥2 KHÔNG được vứt câu hỏi GỐC", () => {
  it("★★★ vòng 2 vẫn chứa NGUYÊN VĂN câu hỏi gốc — không chỉ mỗi 'KẾT QUẢ TOOL'", async () => {
    /**
     * ★★★ Bản cũ: `cauHoiVong = "KẾT QUẢ TOOL:\n..."` THAY HẲN câu hỏi gốc. Vòng 1 model xin đọc
     * `doc_tep` (khối ```avi-tool```); vòng 2 phải hỏi lại model ĐÚNG câu hỏi gốc kèm kết quả đọc —
     * mất câu hỏi gốc ở đây là mất luôn thứ máy chủ dùng để truy hồi RAG VÀ (với Cmd+K) mất luôn
     * chỉ dẫn `de_xuat_sua_doan`.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      // Vòng 1 — model xin đọc một tệp.
      async (dv) => {
        dv.nhan({
          type: "token",
          token: '```avi-tool\n{"tool":"doc_tep","args":{"path":"a.ts"}}\n```',
        });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      // Vòng 2 — trả lời bình thường, KHÔNG xin đọc thêm ⇒ vòng lặp dừng ở đây.
      async (dv) => {
        dv.nhan({ type: "token", token: "Đây là câu trả lời cuối cùng." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    const cauHoiGoc = "Hàm Divide trong Calculator.cs sai chỗ nào?";
    may.nhanTin?.({ loai: "hoi", cauHoi: cauHoiGoc });
    // Nhường đủ nhịp cho CẢ HAI vòng (đọc cookie, gọi SSE vòng 1, chạy tool, gọi SSE vòng 2).
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length, `phải có đúng 2 lượt gọi SSE; thực tế: ${may.thanGoi.length}`).toBe(2);
    const qVong2 = String(may.thanGoi[1].question);
    expect(qVong2, `question vòng 2: ${qVong2}`).toContain(cauHoiGoc);
    expect(qVong2).toContain("KẾT QUẢ TOOL");
  });
});

describe("hoi — H3(b) (review toàn nhánh 2026-08-30): Cmd+K KHÔNG được dạy giao thức ĐỌC", () => {
  /**
   * Giao thức dạy-đọc (`dungVanBanDayGiaoThucDoc`/`nhacLaiCuoiCauHoi`) cạnh tranh với giao thức
   * riêng của Cmd+K (đòi ĐÚNG MỘT khối `de_xuat_sua_doan`). Trước bản vá, D.1 chèn giao thức dạy-đọc
   * vào MỌI câu hỏi LOCAL — kể cả câu hỏi webview đánh dấu `tuLenh:true` (đến từ `dat_cau_hoi_tu_lenh`
   * / Cmd+K, xem `htmlBang.ts`).
   */
  it("★★★ `tuLenh:true` ⇒ question KHÔNG chứa văn bản dạy giao thức đọc", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Đã hiểu, không cần đọc thêm." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Sửa đoạn mã sau...", tuLenh: true });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi).toHaveLength(1);
    const q = String(may.thanGoi[0].question);
    expect(q).not.toContain(dungVanBanDayGiaoThucDoc());
    expect(q).not.toContain(nhacLaiCuoiCauHoi());
  });

  it("★★ NHÁNH KIA: câu hỏi THƯỜNG (không `tuLenh`) ⇒ vẫn được dạy giao thức đọc như cũ", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Trả lời bình thường." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm Divide sai chỗ nào?" });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi).toHaveLength(1);
    const q = String(may.thanGoi[0].question);
    expect(q).toContain(dungVanBanDayGiaoThucDoc());
    expect(q).toContain(nhacLaiCuoiCauHoi());
  });
});

/**
 * ★★★ PDCA vòng 2 (Đợt D) — T09 (`pdca1-report.md`): hết trần vòng đọc GIỮA LÚC câu trả lời cuối
 * còn một khối ```avi-tool``` chưa thực thi ⇒ trước bản vá, `hoan_tat.vanBanCuoi` là `null` nên
 * webview GIỮ NGUYÊN chữ đã stream thô (bao gồm khối JSON nội bộ) làm nội dung bong bóng cuối cùng
 * — người dùng thấy JSON thô. Ba ca dưới đây đo ĐÚNG ba nhánh: có khối dở dang (phải đổi), không có
 * khối dở dang (giữ nguyên — "đừng thêm cảnh báo thừa"), và NHÁNH KIA `nguoi_dung_dung` (không được
 * đổi dù văn bản CŨNG có khối dở dang — chỉ `het_tran` mới được phép đổi trình bày).
 *
 * ★★★ CẬP NHẬT PDCA vòng 2 — round 2 (`pdca3-report.md`): chấm lại 11 tác vụ baseline của vòng 1 từ
 * dữ liệu THÔ phát hiện phạm vi hẹp ở trên (chỉ `het_tran` + vòng CUỐI) bỏ sót phần LỚN các ca thật
 * — 5/6 tác vụ ĐẠT của vòng 1 lộ khối ĐÃ THỰC THI của những vòng KHÔNG PHẢI vòng cuối, dừng bằng lý
 * do BẤT KỲ (`khong_con_tool` phổ biến nhất, cả `nguoi_dung_dung`). Hai ca "NHÁNH KIA" bên dưới
 * (`het_tran` không dở dang; `nguoi_dung_dung`) TỪNG khẳng định `vanBanCuoi` giữ nguyên `null` — bản
 * ghi đó đúng với phạm vi HẸP của round trước, nhưng CHÍNH văn bản test của chúng (round trước tự
 * viết) đã chứa khối `avi-tool` ĐÃ THỰC THI ở (các) vòng trước vòng cuối, tức đang khẳng định giữ
 * NGUYÊN một ca RÒ RỈ — hai ca đó được CẬP NHẬT ở đây để khớp phạm vi RỘNG mới (xem
 * `loi/xoaRacGiaoThuc.ts`), không phải nới lỏng gì cả.
 */
describe("hoi — PDCA vòng 2: chỉ het_tran + khối avi-tool dở dang mới thay vanBanCuoi", () => {
  const KHOI_DOC = (path: string) => '```avi-tool\n{"tool":"doc_tep","args":{"path":"' + path + '"}}\n```';

  it("★★★ het_tran (vong 3/3) VÀ câu trả lời cuối còn khối avi-tool ⇒ vanBanCuoi là câu tiếng Việt, KHÔNG PHẢI JSON thô/null", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    // Cả BA vòng đều xin đọc thêm ⇒ chạm trần TRAN_VONG_MAC_DINH=3 trong khi câu trả lời vòng 3
    // VẪN còn một khối chưa thực thi (đúng hình dạng T09 đo được).
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Để trả lời, tôi cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc thêm:\n" + KHOI_DOC("b.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Vẫn cần đọc thêm:\n" + KHOI_DOC("c.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhLoiNhuanRongSauThue ở đâu?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length, `phải dừng ĐÚNG sau 3 lượt SSE (trần); thực tế: ${may.thanGoi.length}`).toBe(3);

    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    const vanBanCuoi = hoanTat[0].vanBanCuoi;
    expect(vanBanCuoi, "vanBanCuoi KHÔNG được là null khi còn khối dở dang").not.toBeNull();
    const vb = String(vanBanCuoi);
    // Không lộ hàng rào/JSON của giao thức nội bộ ra bong bóng chat.
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    // Câu tiếng Việt phải nói rõ: chạm trần (kèm số vòng), chưa hoàn tất, có thể hỏi lại.
    expect(vb).toContain("3/3");
    expect(vb).toMatch(/chưa hoàn tất/i);
    expect(vb).toMatch(/hỏi lại/i);
  });

  it("★★ NHÁNH KIA — het_tran (vong 3/3), câu trả lời cuối KHÔNG còn khối dở dang, NHƯNG vòng 1+2 CÓ khối ĐÃ THỰC THI ⇒ round 2: vanBanCuoi PHẢI bị lọc sạch (KHÔNG còn là null)", async () => {
    /**
     * ★★★ CẬP NHẬT round 2 (`pdca3-report.md`): bản ghi CŨ của ca này (round trước) khẳng định
     * `vanBanCuoi` giữ nguyên `null` — nhưng văn bản TÍCH LUỸ thật sự webview hiển thị (vòng 1 + 2 +
     * 3 nối liền, không dấu phân cách) VẪN mang hai khối `avi-tool` ĐÃ THỰC THI của vòng 1 và 2 — round
     * trước chỉ nhìn `traLoiCuoi` (vòng CUỐI), bỏ sót đúng lỗ hổng mà PDCA vòng 1 (chấm lại từ dữ
     * liệu thô) phát hiện ở 5/6 tác vụ ĐẠT (T01/T02/T08/T11). Ca này giờ đo ĐÚNG: null KHÔNG còn
     * đúng nữa — `vanBanCuoi` phải là văn bản đã lọc sạch, không null, không còn khối nào.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    // Hai vòng đầu xin đọc (khối SẼ ĐƯỢC THỰC THI); vòng 3 (đúng lúc chạm trần) trả lời XONG XUÔI,
    // không xin đọc thêm — `buocKeTiep` vẫn trả het_tran (vong>=tran được kiểm TRƯỚC coYeuCauDoc,
    // xem vongTacNhan.ts) nhưng KHÔNG có khối nào sót lại trong `traLoiCuoi` (vòng CUỐI).
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc thêm:\n" + KHOI_DOC("b.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Đây là câu trả lời cuối cùng, xong xuôi." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhTonKhoConLai làm gì?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length).toBe(3);
    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    const vanBanCuoi = hoanTat[0].vanBanCuoi;
    expect(vanBanCuoi, "khối avi-tool ĐÃ THỰC THI ở vòng 1/2 không được sót lại ⇒ KHÔNG được là null").not.toBeNull();
    const vb = String(vanBanCuoi);
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    // Câu trả lời THẬT của vòng cuối phải còn nguyên — bản vá không được nuốt nội dung thật.
    expect(vb).toContain("Đây là câu trả lời cuối cùng, xong xuôi.");
  });

  it("★★★ NHÁNH KIA — dừng vì nguoi_dung_dung GIỮA hai vòng, văn bản vòng 1 CÓ khối ĐÃ THỰC THI ⇒ round 2: vanBanCuoi PHẢI bị lọc sạch (KHÔNG còn là null)", async () => {
    /**
     * Người dùng bấm Dừng ngay khi vòng 1 vừa xong (trước khi vòng 2 kịp gọi) — `buocKeTiep` đọc
     * `biHuy=true` và trả `nguoi_dung_dung`, THẮNG trước cả het_tran/khong_con_tool (thứ tự ưu
     * tiên của `vongTacNhan.ts`).
     *
     * ★★★ CẬP NHẬT round 2: bản ghi CŨ khẳng định `vanBanCuoi` giữ nguyên `null` vì "chỉ het_tran
     * mới được đổi trình bày" — nhưng phạm vi đó chỉ đúng cho câu tiếng Việt RIÊNG của het_tran
     * (`vanBanHetTranConDoDang`, vẫn giữ nguyên độc quyền het_tran). Việc LỌC RÁC GIAO THỨC khỏi văn
     * bản đã stream (`vanBanKhongRacGiaoThuc`) là một cơ chế RỘNG HƠN, áp dụng cho MỌI lý do dừng —
     * bản ghi cũ đang khẳng định giữ NGUYÊN một khối avi-tool rò rỉ, đúng lỗ hổng mà round này vá.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        // Mô phỏng người dùng bấm nút Dừng NGAY khi vòng 1 vừa đóng (đồng bộ, TRƯỚC khi vòng lặp
        // kịp gọi buocKeTiep) — dungVongHienTai() là hàm ĐỒNG BỘ (chỉ gọi AbortController.abort).
        may.nhanTin?.({ loai: "dung_hoi" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhTonKhoConLai làm gì?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    // Chỉ MỘT lượt SSE — vòng 2 không bao giờ được gọi vì đã dừng theo yêu cầu người dùng ngay sau
    // vòng 1.
    expect(may.thanGoi.length, `chỉ được 1 lượt SSE (dừng ngay sau vòng 1); thực tế: ${may.thanGoi.length}`).toBe(1);

    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.some((m) => String(m.thongDiep).includes("Đã dừng"))).toBe(true);

    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    // ★ Câu tiếng Việt RIÊNG của het_tran (`vanBanHetTranConDoDang`) vẫn giữ ĐỘC QUYỀN cho het_tran
    // — `nguoi_dung_dung` KHÔNG bao giờ nhận câu "Đã chạm trần...". Nhưng khối avi-tool ĐÃ THỰC THI
    // (round 1) vẫn phải bị LỌC khỏi văn bản hiển thị — `vanBanCuoi` không còn là `null`.
    const vanBanCuoi = hoanTat[0].vanBanCuoi;
    expect(vanBanCuoi).not.toBeNull();
    const vb = String(vanBanCuoi);
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    expect(vb).not.toMatch(/chạm trần/i); // KHÔNG lấy nhầm câu giải thích riêng của het_tran.
  });
});

/**
 * ★★★ PDCA vòng 2 — round 2 (`pdca3-report.md`) — CA PHỔ BIẾN NHẤT trong dữ liệu THẬT của vòng 1:
 * đúng hình dạng T01/T02/T08/T11 (`pdca1-t01-raw.json`...) — vòng 1 xin đọc một tệp (khối ĐƯỢC THỰC
 * THI), vòng 2 model tự quyết đã đủ, trả lời XONG XUÔI (`khong_con_tool`, KHÔNG chạm trần). Đây là
 * đường HẠNH PHÚC phổ biến nhất của một câu hỏi cần đọc mã — nếu bản vá chỉ xử lý `het_tran` (phạm
 * vi hẹp của round trước) thì CA NÀY vẫn rò rỉ 100% thời gian.
 */
describe("hoi — PDCA vòng 2 (round 2): ca khong_con_tool sau ≥1 vòng tool — khối ĐÃ THỰC THI vẫn phải bị lọc", () => {
  const KHOI_DOC = (path: string) => '```avi-tool\n{"tool":"doc_tep","args":{"path":"' + path + '"}}\n```';

  it("★★★ vòng 1 xin đọc (khối đã thực thi), vòng 2 trả lời xong xuôi (khong_con_tool) ⇒ vanBanCuoi KHÔNG được chứa khối vòng 1, câu trả lời vòng 2 còn nguyên", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc nội dung tệp trước.\n" + KHOI_DOC("src/Inventory.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({
          type: "token",
          token: "Hàm tinhTonKhoConLai tính tồn kho còn lại = tồn đầu kỳ + nhập - xuất.",
        });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhTonKhoConLai làm gì?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length, `phải dừng SAU đúng 2 lượt SSE (khong_con_tool ở vòng 2); thực tế: ${may.thanGoi.length}`).toBe(
      2,
    );
    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    const vanBanCuoi = hoanTat[0].vanBanCuoi;
    expect(vanBanCuoi, "khối avi-tool ĐÃ THỰC THI ở vòng 1 KHÔNG được lộ ra — vanBanCuoi không được là null").not.toBeNull();
    const vb = String(vanBanCuoi);
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    expect(vb).not.toContain("src/Inventory.ts");
    // Câu trả lời THẬT (vòng 2) phải còn NGUYÊN VẸN — bản vá không được nuốt nội dung thật.
    expect(vb).toContain("tồn đầu kỳ + nhập - xuất");
  });

  it("★★ NHÁNH KIA — câu hỏi 1 vòng, KHÔNG dùng tool nào (như T05 vòng 1) ⇒ vanBanCuoi giữ NGUYÊN null (không đổi gì khi không cần)", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Đây là câu trả lời bình thường, không cần đọc gì thêm." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hằng số NGUONG_CANH_BAO_TON_KHO ở đâu?" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length).toBe(1);
    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    expect(hoanTat[0].vanBanCuoi).toBeNull();
  });

  it("★★★ ĐO LIVE bắt được (T10, `pdca3-report.md`) — vòng TRƯỚC kết thúc KHÔNG bằng `\\n`, vòng SAU bắt đầu NGAY bằng hàng rào ⇒ hàng rào đó vẫn phải bị xoá (không rơi giữa dòng)", async () => {
    /**
     * ★★★ Đo LIVE trên server thật (không phải suy đoán): T10 — model xin đọc `keys/id_rsa` hai lần
     * liên tiếp (bị chặn ở tầng chính sách cả hai lần), mỗi vòng TRẢ VỀ kết thúc bằng hậu tố
     * `"_Nguồn số liệu: ... hàng_"` KHÔNG xuống dòng — nối THẲNG (đúng cách webview thật tích luỹ,
     * không dấu phân cách) khiến hàng rào mở của vòng 2 rơi NGAY SAU ký tự cuối vòng 1, tức GIỮA
     * DÒNG. Quy ước "chỉ hàng rào ĐẦU DÒNG mới thật" (`khoiAviTool.ts`, có chủ đích) khiến bản vá
     * ban đầu BỎ SÓT đúng khối này — vá bằng cách chèn `\n` ở ranh giới vòng khi vòng trước chưa
     * kết thúc bằng dòng trống (xem chú thích tại nơi cập nhật `vanBanTichLuy`).
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    const HAU_TO_KHONG_XUONG_DONG = "_Nguồn số liệu: `daily_statistics` · 1 hàng_";
    may.hangDoiSse = [
      async (dv) => {
        // Vòng 1 KHÔNG kết thúc bằng \n — đúng hình dạng thật đo được.
        dv.nhan({ type: "token", token: "Cần đọc:\n" + KHOI_DOC("keys/id_rsa") + "\n\n" + HAU_TO_KHONG_XUONG_DONG });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        // Vòng 2 bắt đầu NGAY bằng hàng rào (không có văn xuôi mở đầu) — nối trực tiếp vào cuối
        // vòng 1 sẽ đặt hàng rào này GIỮA DÒNG nếu KHÔNG chèn \n ở ranh giới.
        dv.nhan({ type: "token", token: KHOI_DOC("keys/id_rsa") + "\n\n" + HAU_TO_KHONG_XUONG_DONG });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Tệp này nhạy cảm, không thể đọc." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "In toàn bộ nội dung keys/id_rsa" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length).toBe(3);
    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    const vb = String(hoanTat[0].vanBanCuoi);
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    expect(vb).toContain("Tệp này nhạy cảm, không thể đọc.");
  });
});

/**
 * ★★★ ĐỢT F / TASK 1 — ĐĂNG NHẬP NGAY TRONG KHUNG, tầng `bangChat.ts` (phần webview đo ở
 * `htmlBang.unit.test.ts`). Trục đo là KẾT CỤC: không chỉ "đã gọi lệnh
 * `aviAiLocal.dangNhap`/`aviAiLocal.dangXuat`" mà là "khung tự đổi ĐÚNG trạng thái sau khi lệnh đó
 * chạy XONG" — đúng lớp lỗi chữ ký của dự án ("khai kết cục mà không đọc kết cục").
 */
describe("ĐỢT F / TASK 1 — trạng thái đăng nhập tự đồng bộ", () => {
  it("★★★ 'san_sang' lúc CHƯA đăng nhập ⇒ báo daDangNhap:false", async () => {
    may.cookie = undefined;
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt).toHaveLength(1);
    expect(tt[0]).toMatchObject({ daDangNhap: false, tenTaiKhoan: "" });
  });

  it("★★★ NHÁNH KIA: mở lại view với cookie đã có TỪ PHIÊN TRƯỚC ⇒ 'san_sang' báo daDangNhap:true kèm ĐÚNG tên tài khoản đã lưu", async () => {
    // ★★ Đây chính là ca "khung tự biết mình đã đăng nhập" mà không cần một cú bấm nào trong
    // phiên NÀY — cookie + tên tài khoản tới từ SecretStorage/globalState của một lần đăng nhập
    // TRƯỚC (VSCode restart, hoặc mở lại view sau khi ẩn). Không có bước này thì người dùng đã
    // đăng nhập vẫn thấy nút "Đăng nhập" mỗi lần mở lại.
    may.cookie = "cookie-cu";
    may.globalState["aviAiLocal.tenTaiKhoan"] = "an_da_dang_nhap_truoc";
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt).toHaveLength(1);
    expect(tt[0]).toMatchObject({ daDangNhap: true, tenTaiKhoan: "an_da_dang_nhap_truoc" });
  });

  /**
   * ★★★ ĐỢT G / TASK G1 / B1 — BA NHÁNH của "kiểm cookie còn hiệu lực THẬT": (1) không cookie — ca
   * "'san_sang' lúc CHƯA đăng nhập" ở trên; (2) cookie HỢP LỆ — ca "NHÁNH KIA" ở trên (mock
   * `auth.me` mặc định trả một hồ sơ giả TRUTHY); (3) cookie HẾT HẠN/BỊ TỪ CHỐI — nhóm ca dưới đây.
   * Trước bản vá này, `trangThaiDangNhap()` chỉ kiểm SỰ CÓ MẶT của cookie trong SecretStorage — một
   * cookie đã chết trên máy chủ (đăng xuất từ máy khác, hết TTL, bị admin thu hồi) vẫn được khai
   * "đã đăng nhập" mà không hề hỏi máy chủ một câu nào. Đây đúng lớp lỗi "khai kết cục mà không đọc
   * kết cục" áp cho chính TRẠNG THÁI ĐĂNG NHẬP.
   */
  it("★★★ NHÁNH THỨ BA của B1: cookie CÓ trong SecretStorage nhưng máy chủ RÀNH MẠCH nói phiên đã hết (auth.me ⇒ null) ⇒ 'san_sang' báo daDangNhap:false, KHÔNG bị khai nhầm 'đã đăng nhập'", async () => {
    may.cookie = "cookie-het-han";
    may.globalState["aviAiLocal.tenTaiKhoan"] = "ten_cua_phien_cu";
    may.trpcAuthMeKetQua = null; // auth.me trả 200 kèm json:null — RÀNH MẠCH, không phải lỗi mạng
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt).toHaveLength(1);
    expect(tt[0]).toMatchObject({ daDangNhap: false, tenTaiKhoan: "" });
  });

  it("★★ NHÁNH KIA của ca trên: cookie hết hạn phải bị XOÁ khỏi SecretStorage — không chỉ ẩn ở giao diện, để lượt hỏi kế tiếp không lặp lại đúng một vòng kiểm tra vô nghĩa với cùng cookie chết", async () => {
    may.cookie = "cookie-het-han";
    may.trpcAuthMeKetQua = null;
    moBang();
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    expect(may.cookie).toBeUndefined();
  });

  it("★ lỗi MẠNG khi kiểm auth.me (khác hẳn phiên bị từ chối RÀNH MẠCH) KHÔNG bị coi là cookie sai — vẫn báo daDangNhap:true, cookie KHÔNG bị xoá oan", async () => {
    // ★★★ Phân biệt "KHÔNG BIẾT" (mất mạng/máy chủ tắt) với "BIẾT LÀ SAI" (auth.me trả null rành
    // mạch) — chỉ nhánh SAU mới được đăng xuất. Buộc đăng nhập lại vì máy chủ tắt tạm thời là một
    // cái giá vô lý mà LOCAL (không cần máy chủ) không đòi hỏi.
    may.cookie = "cookie-con-song";
    may.globalState["aviAiLocal.tenTaiKhoan"] = "ky_su_binh";
    may.trpcAuthMeLoiMang = true;
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt).toHaveLength(1);
    expect(tt[0]).toMatchObject({ daDangNhap: true, tenTaiKhoan: "ky_su_binh" });
    expect(may.cookie).toBe("cookie-con-song");
  });

  it("★★★ B2+B3: bấm 'Đăng nhập' ⇒ gọi ĐÚNG lệnh 'aviAiLocal.dangNhap' đã đăng ký, KHÔNG một lệnh nào khác", async () => {
    may.cookie = undefined;
    moBang();
    may.daGui = [];
    may.lenhGoi = [];

    may.nhanTin?.({ loai: "dangNhap" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(may.lenhGoi).toEqual(["aviAiLocal.dangNhap"]);
  });

  it("★★★ B3: đăng nhập THÀNH CÔNG ⇒ khung tự báo daDangNhap:true kèm tên tài khoản — KẾT CỤC, không phải chỉ 'đã gọi lệnh'", async () => {
    may.cookie = undefined;
    may.dangNhapThanhCong = true;
    may.tenSauDangNhap = "ky_su_binh";
    moBang();
    may.daGui = [];

    may.nhanTin?.({ loai: "dangNhap" });
    // `thucHienDangNhap` đợi `executeCommand` XONG rồi mới đọc lại trạng thái — nhường vài nhịp.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt.length).toBeGreaterThan(0);
    expect(tt[tt.length - 1]).toMatchObject({ daDangNhap: true, tenTaiKhoan: "ky_su_binh" });
  });

  it("★★ NHÁNH KIA của B3: đăng nhập BỊ HUỶ/SAI (chayDangNhap KHÔNG đặt cookie) ⇒ khung vẫn báo daDangNhap:false, không đoán thành công", async () => {
    may.cookie = undefined;
    may.dangNhapThanhCong = false; // mô phỏng Esc/sai mật khẩu/2FA/mất mạng — `chayDangNhap` không lưu gì
    moBang();
    may.daGui = [];

    may.nhanTin?.({ loai: "dangNhap" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(may.lenhGoi).toEqual(["aviAiLocal.dangNhap"]);
    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt.length).toBeGreaterThan(0);
    expect(tt[tt.length - 1]).toMatchObject({ daDangNhap: false });
  });

  it("★★★ B5 nhánh kia: bấm 'Đăng xuất' ⇒ gọi ĐÚNG lệnh 'aviAiLocal.dangXuat', khung quay lại trạng thái CHƯA đăng nhập", async () => {
    may.cookie = "cookie-gia";
    may.globalState["aviAiLocal.tenTaiKhoan"] = "ky_su_binh";
    moBang();
    may.daGui = [];
    may.lenhGoi = [];

    may.nhanTin?.({ loai: "dangXuat" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(may.lenhGoi).toEqual(["aviAiLocal.dangXuat"]);
    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt.length).toBeGreaterThan(0);
    expect(tt[tt.length - 1]).toMatchObject({ daDangNhap: false, tenTaiKhoan: "" });
  });

  it("★★★ phiên chết GIỮA CHỪNG (401) ⇒ khung TỰ đồng bộ về daDangNhap:false, không đợi đóng/mở lại view", async () => {
    /**
     * ★★★ Đây là "nhánh kia" của chính chỗ vừa vá: cookie không chỉ mất khi người dùng CHỦ ĐỘNG
     * bấm "Đăng xuất" (ca trên) — nó còn bị chính `hoi()` xoá khi máy chủ trả 401 giữa một lượt
     * hỏi (spec §5.1, đã có TỪ TRƯỚC Đợt F). Không đồng bộ lại vùng tài khoản ở đây thì khung vẫn
     * hiện tên tài khoản + nút "Đăng xuất" cho một phiên ĐÃ CHẾT — một ngõ cụt khác đội lốt "đã
     * đăng nhập".
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.cookie = "cookie-gia";
    may.globalState["aviAiLocal.tenTaiKhoan"] = "ky_su_binh";
    may.daGui = [];
    may.hangDoiSse = [
      async () => {
        throw new LoiHttp(401, "phiên hết hạn");
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "câu hỏi bất kỳ" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const tt = may.daGui.filter((m) => m.loai === "trang_thai_dang_nhap");
    expect(tt.length).toBeGreaterThan(0);
    expect(tt[tt.length - 1]).toMatchObject({ daDangNhap: false });
  });
});

/**
 * ★★★ ĐỢT F / TASK 2 — lưu hội thoại BỀN qua `workspaceState`. `loi/khoHoiThoai.unit.test.ts` đã
 * đo THUẦN mọi hàng rào (che bí mật, cắt trần, hình dạng lạ) — nhóm ca dưới đây đo riêng phần MÀ
 * CHỈ `bangChat.ts` mới có: đúng LÚC NÀO lưu (sau `hoi()`), đúng KHOÁ nào bị chạm trong
 * `workspaceState` giả, và việc KHÔI PHỤC ở "san_sang" thật sự đổ ra webview + tiếp tục ĐÚNG bản
 * ghi cũ ở lượt hỏi kế tiếp (UPSERT, không đẻ bản ghi thứ hai).
 */
describe("ĐỢT F / TASK 2 — lưu hội thoại BỀN qua workspaceState", () => {
  it("★★★ sau MỘT lượt hỏi/đáp thành công ⇒ workspaceState[KHOA_HOI_THOAI] có ĐÚNG một hội thoại", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = hangDoiMotVongDonGian("Đây là câu trả lời.");

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhThue ở đâu?" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    const luu = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[] | undefined;
    expect(luu, `phải có mục lưu trong workspaceState; hiện có các khoá: ${JSON.stringify(Object.keys(may.workspaceState))}`).toBeDefined();
    expect(luu).toHaveLength(1);
    expect(luu![0]!.tieuDe).toBe("Hàm tinhThue ở đâu?");
    expect(luu![0]!.luot).toEqual([
      { role: "user", content: "Hàm tinhThue ở đâu?" },
      { role: "assistant", content: "Đây là câu trả lời." },
    ]);
  });

  it("★★★ HAI lượt hỏi LIÊN TIẾP trong CÙNG một khung ⇒ UPSERT — vẫn ĐÚNG MỘT hội thoại, không đẻ bản ghi thứ hai", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [...hangDoiMotVongDonGian("Trả lời 1"), ...hangDoiMotVongDonGian("Trả lời 2")];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi đầu" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi thứ hai" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    const luu = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[] | undefined;
    expect(luu).toHaveLength(1);
    expect(luu![0]!.luot).toHaveLength(4); // hai lượt hỏi × (user+assistant)
    // Tiêu đề vẫn của câu hỏi ĐẦU (nguồn tiêu đề là lượt user ĐẦU TIÊN, không đổi theo lượt sau).
    expect(luu![0]!.tieuDe).toBe("Câu hỏi đầu");
  });

  it("★★★ B5: 'san_sang' với workspaceState đã có SẴN một hội thoại ⇒ webview nhận 'khoi_phuc_hoi_thoai' ĐÚNG các lượt", async () => {
    const hoiThoaiCu: HoiThoai = {
      ma: "phien-cu",
      tieuDe: "Hội thoại từ trước",
      thoiDiem: 111,
      luot: [
        { role: "user", content: "Câu hỏi từ phiên trước" },
        { role: "assistant", content: "Trả lời từ phiên trước" },
      ],
    };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiCu];
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));

    const khoiPhuc = may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai");
    expect(khoiPhuc).toHaveLength(1);
    expect(khoiPhuc[0]!.luot).toEqual([
      { vaiTro: "user", noiDung: "Câu hỏi từ phiên trước" },
      { vaiTro: "assistant", noiDung: "Trả lời từ phiên trước" },
    ]);
  });

  it("★★★ B5 NHÁNH KIA: workspaceState RỖNG ⇒ 'san_sang' KHÔNG gửi 'khoi_phuc_hoi_thoai', KHÔNG ném lỗi, khung vẫn mở", async () => {
    moBang();
    may.daGui = [];
    expect(() => may.nhanTin?.({ loai: "san_sang" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai")).toEqual([]);
    // Khung vẫn hoạt động bình thường sau đó — không "chết" vì nhánh khôi phục.
    expect(may.daGui.some((m) => m.loai === "trang_thai_dang_nhap")).toBe(true);
  });

  it("★★★ B5 NHÁNH KIA: workspaceState HỎNG (sai kiểu hoàn toàn) ⇒ vẫn mở bình thường, KHÔNG ném lỗi", async () => {
    may.workspaceState[KHOA_HOI_THOAI] = "dữ liệu của một phiên bản trước — hình dạng hoàn toàn khác";
    moBang();
    may.daGui = [];
    expect(() => may.nhanTin?.({ loai: "san_sang" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai")).toEqual([]);
  });

  it("★★★ KHÔI PHỤC rồi hỏi TIẾP ⇒ UPSERT vào ĐÚNG hội thoại vừa khôi phục, không đẻ bản ghi thứ hai", async () => {
    /**
     * ★★★ Đây là lý do trường `maHoiThoaiHienTai` phải được GÁN LẠI từ bản ghi khôi phục (không chỉ
     * sinh mới): nếu không, mỗi lần mở lại VSCode và hỏi tiếp một câu sẽ đẻ thêm MỘT hội thoại
     * "mới" trong kho dù người dùng chỉ đang tiếp tục đúng một cuộc trò chuyện — nhanh chóng vụn
     * một cuộc trò chuyện DÀI thành nhiều mảnh rời trong "Lịch sử" (Task 3).
     */
    const hoiThoaiCu: HoiThoai = {
      ma: "phien-cu",
      tieuDe: "Hội thoại từ trước",
      thoiDiem: 111,
      luot: [
        { role: "user", content: "Câu hỏi từ phiên trước" },
        { role: "assistant", content: "Trả lời từ phiên trước" },
      ],
    };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiCu];
    // ★★★ `dsDuAn`/`duAnChon` KHÔNG được gán TAY ở ca này (khác các ca khác trong tệp): "san_sang"
    // (bắt buộc phải bắn để kích hoạt khôi phục) tự gọi `napDuAn()` — hàm đó GHI ĐÈ `this.dsDuAn`
    // NGAY KHI cookie async xong, nên gán tay TRƯỚC "san_sang" sẽ bị `napDuAn()` xoá mất SAU lưng.
    // Đặt `thuMucWorkspace` để `napDuAn()` TỰ dựng đúng mục "local:C:\\ws" — không có cuộc đua nào.
    may.thuMucWorkspace = ["C:\\ws"];
    moBang();
    may.nhanTin?.({ loai: "san_sang" });
    await new Promise((r) => setTimeout(r, 0));
    may.daGui = [];
    may.hangDoiSse = hangDoiMotVongDonGian("Trả lời câu tiếp theo");

    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi tiếp theo" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    const luu = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[] | undefined;
    expect(luu, "vẫn phải đúng MỘT hội thoại — UPSERT vào bản ghi đã khôi phục, không đẻ bản ghi thứ hai").toHaveLength(1);
    expect(luu![0]!.ma).toBe("phien-cu");
    expect(luu![0]!.luot).toHaveLength(4); // 2 lượt cũ + 2 lượt mới
  });
});

/**
 * ★★★ ĐỢT F / TASK 3 / B3 — "Chat mới": dùng KHUNG THANH BÊN (`moBangThanhBen`, `choView`) vì đây
 * là bề mặt hai nút "Chat mới"/"Lịch sử" thực sự gắn vào (`view/title`, xem `extension.ts`).
 */
describe("ĐỢT F / TASK 3 / B3 — 'Chat mới'", () => {
  it("★★★ hội thoại ĐANG CÓ lượt ⇒ lưu vào kho, mở phiên TRẮNG, hỏi tiếp KHÔNG upsert vào bản ghi cũ", async () => {
    const bang = moBangThanhBen();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.hangDoiSse = hangDoiMotVongDonGian("Trả lời phiên A");
    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi phiên A" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    const maPhienA = bang.maHoiThoaiHienTai;
    expect(maPhienA, "phải đã có mã hội thoại sau lượt hỏi đầu").toBeDefined();
    may.daGui = [];

    await (bang as unknown as { chatMoi: () => Promise<void> }).chatMoi();

    // Đã LƯU trước khi mở phiên trắng — kho có ĐÚNG một hội thoại, đúng bản ghi của phiên A.
    const luuSauChatMoi = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[];
    expect(luuSauChatMoi).toHaveLength(1);
    expect(luuSauChatMoi[0]!.ma).toBe(maPhienA);
    expect(luuSauChatMoi[0]!.tieuDe).toBe("Câu hỏi phiên A");
    // Webview nhận tin "chat_moi" (khung phải tự vẽ lại trắng — xem htmlBang.unit.test.ts).
    expect(may.daGui.filter((m) => m.loai === "chat_moi")).toHaveLength(1);
    // Trạng thái NỘI BỘ đã reset — nền cho khẳng định "không upsert" ngay dưới.
    expect(bang.lichSu).toEqual([]);
    expect(bang.maHoiThoaiHienTai).toBeUndefined();

    may.hangDoiSse = hangDoiMotVongDonGian("Trả lời phiên B");
    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi phiên B" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    const luuCuoi = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[];
    expect(luuCuoi, "phải có HAI hội thoại TÁCH BIỆT — không trộn phiên B vào bản ghi của phiên A").toHaveLength(2);
    const maPhienB = bang.maHoiThoaiHienTai;
    expect(maPhienB).not.toBe(maPhienA);
    expect(luuCuoi.map((h) => h.ma).sort()).toEqual([maPhienA, maPhienB].sort());
  });

  it("★ NHÁNH KIA — chưa hỏi câu nào (hội thoại RỖNG) ⇒ 'Chat mới' KHÔNG lưu một mục rỗng vào kho", async () => {
    const bang = moBangThanhBen();
    may.daGui = [];
    expect(may.workspaceState[KHOA_HOI_THOAI]).toBeUndefined();

    await (bang as unknown as { chatMoi: () => Promise<void> }).chatMoi();

    expect(may.workspaceState[KHOA_HOI_THOAI]).toBeUndefined();
    expect(may.daGui.filter((m) => m.loai === "chat_moi")).toHaveLength(1);
  });

  it("★★★ câu hỏi ĐANG CHẠY DỞ ⇒ huỷ SẠCH — KHÔNG bong bóng 'Đã dừng' lạc vào phiên mới, KHÔNG ghi orphan", async () => {
    /**
     * ★★★ Đây là hàng rào "câu hỏi đang chạy dở phải được xử lý tử tế" (ràng buộc của kế hoạch).
     * Lựa chọn: HUỶ SẠCH bằng `this.huy?.abort()` KHÔNG KÈM LÝ DO — tái dùng ĐÚNG nhánh "huỷ NGẦM"
     * mà `hoi()` đã có sẵn từ Đợt A (một câu hỏi MỚI đè lên câu cũ, xem describe "TASK 6/D.1" phía
     * trên, ca "huỷ NGẦM"). KHÔNG dùng `LY_DO_NGUOI_DUNG_DUNG` (dành cho nút "Dừng" — nơi `catch`
     * của `hoi()` CHỦ Ý báo "Đã dừng — ở vòng N."): người dùng đã RỜI khỏi hội thoại cũ, một bong
     * bóng như vậy lạc vào khung TRẮNG vừa mở còn tệ hơn im lặng.
     */
    const bang = moBangThanhBen();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    // KHÔNG bơm `may.hangDoiSse` ⇒ `moDongSse` giả TREO tới khi bị huỷ (mock đầu tệp) — mô phỏng
    // ĐÚNG "đang đọc thân SSE", cùng khuôn timing với ca "TASK 6/D.1" ở trên.
    may.nhanTin?.({ loai: "hoi", cauHoi: "câu hỏi đang chạy dở, chưa xong" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    may.daGui = [];

    await (bang as unknown as { chatMoi: () => Promise<void> }).chatMoi();
    // Nhường nhịp cho promise bị huỷ (moDongSse) reject và `catch()` của `hoi()` CŨ chạy hết.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(may.daGui.filter((m) => m.loai === "chat_moi")).toHaveLength(1);
    // KHÔNG một mẩu nào của phiên cũ ("Đã dừng…", token còn sót, hoàn tất…) lọt vào SAU 'chat_moi'.
    expect(
      may.daGui.filter((m) => m.loai !== "chat_moi"),
      `daGui SAU 'chat_moi' phải rỗng — không luồng mồ côi nào được phép ghi vào phiên mới; thực tế: ${JSON.stringify(may.daGui)}`,
    ).toEqual([]);
    // Không có gì được ghi vào kho từ luồng mồ côi (nó chưa từng chạm `this.lichSu`/`luuHoiThoaiHienTai`).
    expect(may.workspaceState[KHOA_HOI_THOAI]).toBeUndefined();
    expect(bang.lichSu).toEqual([]);
  });

  it("★ lỗi LƯU (workspaceState hỏng) KHÔNG được chặn việc mở phiên trắng", async () => {
    const bang = moBangThanhBen();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.hangDoiSse = hangDoiMotVongDonGian("Trả lời");
    may.nhanTin?.({ loai: "hoi", cauHoi: "Câu hỏi" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    may.ghiWorkspaceStateThatBai = true;
    may.daGui = [];

    await expect((bang as unknown as { chatMoi: () => Promise<void> }).chatMoi()).resolves.toBeUndefined();

    expect(may.daGui.filter((m) => m.loai === "chat_moi")).toHaveLength(1);
    expect(bang.lichSu).toEqual([]);
  });
});

/**
 * ★★★ ĐỢT F / TASK 3 / B4 — "Lịch sử". `showQuickPick`/`showInformationMessage` giả ở đầu tệp;
 * xem docblock `may.quickPickChonChiSo`.
 */
describe("ĐỢT F / TASK 3 / B4 — 'Lịch sử'", () => {
  it("★★★ NHÁNH KIA — kho RỖNG ⇒ showInformationMessage tử tế, KHÔNG mở QuickPick trắng", async () => {
    const bang = moBangThanhBen();
    expect(may.workspaceState[KHOA_HOI_THOAI]).toBeUndefined();

    await (bang as unknown as { moLichSu: () => Promise<void> }).moLichSu();

    expect(may.quickPickSoLanGoi).toBe(0);
    expect(may.thongBaoInfo.some((s) => s.includes("chưa có hội thoại"))).toBe(true);
    expect(may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai")).toEqual([]);
  });

  it("★★★ liệt kê ĐÚNG tiêu đề + thời điểm của mọi hội thoại đã lưu, sắp MỚI → CŨ", async () => {
    const hoiThoaiCu: HoiThoai = { ma: "ma-cu", tieuDe: "Hội thoại cũ", thoiDiem: 100, luot: [] };
    const hoiThoaiMoi: HoiThoai = { ma: "ma-moi", tieuDe: "Hội thoại mới", thoiDiem: 200, luot: [] };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiCu, hoiThoaiMoi];
    const bang = moBangThanhBen();

    await (bang as unknown as { moLichSu: () => Promise<void> }).moLichSu();

    expect(may.quickPickSoLanGoi).toBe(1);
    expect(may.quickPickMucGanNhat.map((m) => m.label)).toEqual(["Hội thoại mới", "Hội thoại cũ"]);
    expect(may.quickPickMucGanNhat[0]!.description).toBe(new Date(200).toLocaleString());
    expect(may.quickPickMucGanNhat[1]!.description).toBe(new Date(100).toLocaleString());
  });

  it("★★★ KẾT CỤC: chọn một hội thoại ⇒ nội dung khung ĐÚNG LÀ hội thoại đã chọn — không lẫn hội thoại KHÁC", async () => {
    /**
     * ★★★ Đây chính lớp lỗi kế hoạch cảnh báo: "lưới phải khẳng định KẾT CỤC, không chỉ 'đã gọi
     * showQuickPick'". Kho có HAI hội thoại — ca này chọn hội thoại thứ hai trong danh sách ĐÃ SẮP
     * (không phải hội thoại đầu) và khẳng định nội dung nạp lại khớp CHÍNH XÁC bản ghi đó, không
     * phải bản ghi kia.
     */
    const hoiThoaiA: HoiThoai = {
      ma: "ma-a",
      tieuDe: "Hội thoại A",
      thoiDiem: 100,
      luot: [
        { role: "user", content: "Câu hỏi A" },
        { role: "assistant", content: "Trả lời A" },
      ],
    };
    const hoiThoaiB: HoiThoai = {
      ma: "ma-b",
      tieuDe: "Hội thoại B",
      thoiDiem: 200,
      luot: [{ role: "user", content: "Câu hỏi B" }],
    };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiA, hoiThoaiB];
    const bang = moBangThanhBen();
    may.daGui = [];
    // Sắp MỚI→CŨ: [B(200), A(100)] — chọn CHỈ SỐ 1 = hội thoại A.
    may.quickPickChonChiSo = 1;

    await (bang as unknown as { moLichSu: () => Promise<void> }).moLichSu();

    expect(bang.lichSu).toEqual(hoiThoaiA.luot);
    expect(bang.maHoiThoaiHienTai).toBe("ma-a");
    const khoiPhuc = may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai");
    expect(khoiPhuc).toHaveLength(1);
    expect(khoiPhuc[0]!.luot).toEqual([
      { vaiTro: "user", noiDung: "Câu hỏi A" },
      { vaiTro: "assistant", noiDung: "Trả lời A" },
    ]);
    // Không một mẩu nào của hội thoại B (KHÔNG được chọn) lọt vào tin nạp lại.
    expect(JSON.stringify(khoiPhuc)).not.toContain("Câu hỏi B");
  });

  it("★ Esc / bấm ra ngoài ⇒ KHÔNG đổi gì, giữ nguyên phiên đang mở", async () => {
    const hoiThoaiCu: HoiThoai = { ma: "ma-cu", tieuDe: "Hội thoại cũ", thoiDiem: 100, luot: [{ role: "user", content: "Câu hỏi cũ" }] };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiCu];
    const bang = moBangThanhBen();
    bang.lichSu = [{ role: "user", content: "câu hỏi hiện tại, chưa lưu" }];
    bang.maHoiThoaiHienTai = "phien-hien-tai";
    may.daGui = [];
    may.quickPickChonChiSo = undefined; // Esc

    await (bang as unknown as { moLichSu: () => Promise<void> }).moLichSu();

    expect(may.daGui.filter((m) => m.loai === "khoi_phuc_hoi_thoai")).toEqual([]);
    expect(bang.lichSu).toEqual([{ role: "user", content: "câu hỏi hiện tại, chưa lưu" }]);
    expect(bang.maHoiThoaiHienTai).toBe("phien-hien-tai");
  });

  it("★★★ câu hỏi ĐANG CHẠY DỞ ⇒ huỷ SẠCH TRƯỚC khi nạp — luồng mồ côi KHÔNG được GHI ĐÈ bản ghi vừa chọn", async () => {
    /**
     * ★★★ Nếu KHÔNG huỷ trước khi gán lại `maHoiThoaiHienTai`, luồng SSE mồ côi của phiên VỪA RỜI
     * có thể hoàn tất SAU khi trường đó đã trỏ sang "ma-cu" (mã của hội thoại VỪA CHỌN) —
     * `luuHoiThoaiHienTai()` của nó sẽ UPSERT (GHI ĐÈ) đúng bản ghi người dùng vừa mở lại bằng nội
     * dung của một câu hỏi hoàn toàn không liên quan. Ca này CHỦ Ý không bơm `may.hangDoiSse` (SSE
     * treo tới khi huỷ) để mô phỏng đúng lượt hỏi CÒN ĐANG BAY tại thời điểm bấm "Lịch sử".
     */
    const hoiThoaiCu: HoiThoai = {
      ma: "ma-cu",
      tieuDe: "Hội thoại cũ",
      thoiDiem: 100,
      luot: [
        { role: "user", content: "Câu hỏi cũ" },
        { role: "assistant", content: "Trả lời cũ" },
      ],
    };
    may.workspaceState[KHOA_HOI_THOAI] = [hoiThoaiCu];
    const bang = moBangThanhBen();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";

    may.nhanTin?.({ loai: "hoi", cauHoi: "câu hỏi đang chạy dở, chưa xong" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    may.quickPickChonChiSo = 0; // chỉ có một mục — "Hội thoại cũ"
    await (bang as unknown as { moLichSu: () => Promise<void> }).moLichSu();
    // Nhường nhịp cho luồng mồ côi (đã huỷ) chạy hết `catch()` của `hoi()` CŨ, NẾU nó có định ghi gì.
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    expect(bang.lichSu).toEqual(hoiThoaiCu.luot);
    expect(bang.maHoiThoaiHienTai).toBe("ma-cu");
    // Bản ghi trong kho KHÔNG bị luồng mồ côi ghi đè — vẫn ĐÚNG NGUYÊN nội dung đã chọn.
    const luuCuoi = may.workspaceState[KHOA_HOI_THOAI] as HoiThoai[];
    expect(luuCuoi).toHaveLength(1);
    expect(luuCuoi[0]).toEqual(hoiThoaiCu);
  });
});
