// @vitest-environment jsdom
//
/**
 * nganXuLyNoiHanhDong.dom.test.tsx — Task 9/10/11 + nhãn phạm vi (kế hoạch
 * `2026-09-15-hoan-thien-twin-sau-qa11.md`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỐN KHUYẾT TẬT ĐO ĐƯỢC TRƯỚC KHI VÁ — mỗi mục một mốc ĐỎ
 * ════════════════════════════════════════════════════════════════════════════
 *  T9  Bảng hành động khai đúng SÁU mã và **không có** hành động bật cảnh báo,
 *      trong khi `server/routers/andonRouter.ts` có `raise` (:199) và
 *      `quickReport` (:239), cả hai gác `andon`/canCreate, và khuôn quyền mặc
 *      định của vai `operator` ĐÃ có `andon` canCreate=true. Sản phẩm đã trao
 *      quyền, máy chủ đã có đường, chỉ thiếu nút.
 *  T10 `/twin` (màn nhà máy) render `NganXuLy` nhưng nút hành động = 0 với MỌI
 *      vai: sau QĐ-23, mọi cú bấm máy RỜI trang sang `/twin/may/:id`, nên
 *      `machineIdChon` trên thân `/twin` luôn `null`. Một tầng 21 cảnh báo là
 *      21 lần đi-về. Bản vá KHÔNG được đụng QĐ-23 (bấm máy vẫn rời trang) —
 *      nó mở một đường THỨ HAI: xử lý TẠI CHỖ từ dòng cảnh báo.
 *  T11 `loaiDich` khai ở `NganXuLy` nhưng 0 chỗ gọi sản phẩm truyền giá trị
 *      khác `machine`, và nhánh "chưa chọn máy" trả về TRƯỚC nhóm §9.3 nên
 *      quản đốc đứng ở cấp nhà máy không thấy một đích nào.
 *  NP  Hai con số cùng màn đếm trên hai mẫu số khác cảnh: ô đếm máy panel trái
 *      đếm theo NHÀ MÁY (cố ý — `cayVanHanh.ts:58-61`), dải cảnh báo đếm theo
 *      TOÀN PHẠM VI TÀI KHOẢN (`andon.active` không nhận `factoryId`).
 *      Chủ dự án chốt: KHÔNG đổi cách đếm, chỉ NÓI RA phạm vi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI TẦNG ĐO — cùng khuôn `nhungTaiCho.dom.test.tsx`
 * ════════════════════════════════════════════════════════════════════════════
 *   TẦNG 1 — VĂN BẢN CHỖ NỐI: một hành động có trong bảng mà trang không truyền
 *            quyền xuống thì nó chết câm (G16). Đọc mã THẬT của trang.
 *   TẦNG 2 — HÀNH VI: render component thật, bấm nút thật, hỏi mutation nào
 *            được gọi với đối số nào.
 *
 * ⚠ G5 — mọi ca dựng dữ kiện KHÁC RỖNG và có ca ĐỐI CHỨNG biết kêu: một ngăn
 *   render 0 nút cũng "không gọi mutation nào".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DaiCanhBao } from "./DaiCanhBao";
import { NganXuLy, type NganXuLyProps } from "./NganXuLy";
import type { CanhBaoDai } from "./daiCanhBaoLogic";
import { hanhDongChoVatThe, type QuyenXuLy } from "./nganXuLyLogic";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bệ đỡ                                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: unknown, opt?: Record<string, unknown>) => {
      const nen = typeof f === "string" ? f : k;
      const bien = (typeof f === "object" && f !== null ? f : opt) as
        | Record<string, unknown>
        | undefined;
      return bien
        ? nen.replace(/\{\{(\w+)\}\}/g, (_, x: string) => String(bien[x] ?? ""))
        : nen;
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * ★ Điểm trpc của `NganXuLy` — ĐỌC TỪ NGUỒN, không đoán tên (G24).
 *   `quickReport` là điểm MỚI của Task 9; nó phải nằm trong bản mock, và
 *   `guiSuCo` giữ lại lời gọi để ca hành vi đọc đối số THẬT.
 */
const guiSuCo = vi.fn();
const guiAck = vi.fn();
/**
 * ★ ĐỢT 25 VIỆC 2 — điểm trpc MỚI của ghi chú.
 *
 * `danhSachGhiChu` là một `useQuery`, nên bản mock phải trả dữ liệu ĐỔI ĐƯỢC theo
 * từng ca (rỗng / hai dòng). Giữ nó trong một **hộp** thay vì một `let` trần: thân
 * hàm chỉ đọc `kho.dsGhiChu` lúc render, nên không có chuyện đọc phải giá trị của
 * ca trước hay vướng thứ tự khởi tạo của `vi.mock`.
 */
const guiGhiChu = vi.fn();
const kho: { dsGhiChu: unknown[] } = { dsGhiChu: [] };
vi.mock("@/lib/trpc", () => {
  const truyVan = (data: unknown) => () => ({
    data,
    isLoading: false,
    isError: false,
    error: null,
  });
  return {
    trpc: {
      andon: {
        acknowledge: { useMutation: () => ({ mutate: guiAck, isPending: false }) },
        quickReport: { useMutation: () => ({ mutate: guiSuCo, isPending: false }) },
        ghiChu: { useMutation: () => ({ mutate: guiGhiChu, isPending: false }) },
        danhSachGhiChu: {
          useQuery: () => ({ data: kho.dsGhiChu, isLoading: false, isError: false, error: null }),
        },
      },
      maintenance: { createWorkOrder: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      equipmentStandards: { shelveMasterAlarm: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      user: { assignableTechnicians: { useQuery: truyVan([]) } },
      dashboard: { getMachineStats: { useQuery: truyVan(null) } },
    },
  };
});

vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn() }));

afterEach(() => {
  cleanup();
  guiSuCo.mockClear();
  guiAck.mockClear();
  guiGhiChu.mockClear();
  kho.dsGhiChu = [];
});

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
const TRANG = doc("src/pages/TwinVanHanh.tsx");
const NGAN = doc("src/components/twin3d/van-hanh/NganXuLy.tsx");
const DAI = doc("src/components/twin3d/van-hanh/DaiCanhBao.tsx");
/** Máy chủ — đọc từ ĐĨA, không chép lời khai vào lưới (G24). */
const ROUTER_ANDON = readFileSync(
  resolve(GOC, "../server/routers/andonRouter.ts"),
  "utf8",
);
const KHUON_QUYEN = readFileSync(
  resolve(GOC, "../server/routers/permissionsRouter.ts"),
  "utf8",
);
/** Màn OEE — nguồn sự thật cho câu "đích cấp nhà máy nào ĐỌC được tham số". */
const MAN_OEE = doc("src/pages/OEEDashboard.tsx");
const MAN_ANDON = doc("src/pages/AndonBoard.tsx");
const MAN_SAN_XUAT = doc("src/pages/ProductionDashboard.tsx");

const BAY_GIO = Date.parse("2026-09-15T08:00:00.000Z");

/** Quyền ĐỦ — mọi nút hiện. Ca rỗng quyền là ĐỐI CHỨNG, khai riêng. */
const QUYEN_DU: QuyenXuLy = {
  ackAlarm: true,
  anTamAlarm: true,
  taoPhieu: true,
  suaPhieu: true,
  baoSuCo: true,
};

function dungProps(ghiDe: Partial<NganXuLyProps> = {}): NganXuLyProps {
  return {
    machineId: 42,
    ma: "QATD-A-T1-X1-L1-M07",
    ten: "Máy dán keo",
    trangThai: { trangThai: "chay", tuoi: "tuoi", daGhiDe: false },
    thoiDiemDuLieu: BAY_GIO,
    bayGio: BAY_GIO,
    canhBao: [],
    quyen: QUYEN_DU,
    coQuyenXem: () => true,
    onDaXuLy: vi.fn(),
    onDieuHuong: vi.fn(),
    ...ghiDe,
  };
}

function cb(sua: Partial<CanhBaoDai> = {}): CanhBaoDai {
  return {
    nguon: "andon",
    idNguon: 7,
    muc: "red",
    pha: "raised",
    tieuDe: "Kẹt phôi băng tải",
    luc: BAY_GIO - 60_000,
    capNhatLuc: BAY_GIO - 60_000,
    machineId: 42,
    lineId: null,
    stationId: null,
    workshopId: null,
    maMay: "QATD-A-T1-X1-L1-M07",
    tenNhaMay: "Công ty A",
    ...sua,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* T9 — BÁO SỰ CỐ                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ T9 — công nhân báo sự cố ngay trên Twin", () => {
  it("★ ĐỐI CHỨNG MÁY CHỦ — `quickReport` CÓ THẬT và gác `andon`/canCreate (đọc từ đĩa)", () => {
    expect(ROUTER_ANDON).toContain("quickReport: protectedProcedure");
    const i = ROUTER_ANDON.indexOf("quickReport: protectedProcedure");
    expect(ROUTER_ANDON.slice(i, i + 200)).toContain('requirePermission("andon", "canCreate")');
  });

  it("★ ĐỐI CHỨNG KHUÔN QUYỀN — vai `operator` mặc định ĐÃ có `andon` canCreate=true", () => {
    const i = KHUON_QUYEN.indexOf("  operator: [");
    expect(i).toBeGreaterThan(-1);
    const khoi = KHUON_QUYEN.slice(i, KHUON_QUYEN.indexOf("  ],", i));
    expect(khoi).toMatch(/moduleName: 'andon'[^\n]*canCreate: true/);
  });

  it("★★★ vai có `andon` mức TẠO ⇒ bảng hành động có `baoSuCo`", () => {
    const ds = hanhDongChoVatThe({
      quyen: { ...QUYEN_DU, baoSuCo: true },
      machineId: 7,
      canhBao: [],
    });
    expect(ds.map((h) => h.ma)).toContain("baoSuCo");
    expect(ds.find((h) => h.ma === "baoSuCo")?.duocPhep).toBe(true);
    // KHÔNG cần có cảnh báo sẵn: báo sự cố là để TẠO cảnh báo đầu tiên.
    expect(ds.find((h) => h.ma === "baoSuCo")?.lyDoChan).toBeNull();
  });

  it("★★★ KHÔNG có `andon` mức tạo ⇒ `duocPhep=false` ⇒ ẨN (luật ẨN-KHÔNG-DISABLE)", () => {
    const ds = hanhDongChoVatThe({
      quyen: { ...QUYEN_DU, baoSuCo: false },
      machineId: 7,
      canhBao: [],
    });
    expect(ds.find((h) => h.ma === "baoSuCo")?.duocPhep).toBe(false);
  });

  it("★ chưa chọn máy ⇒ `lyDoChan = chua_chon_may` (tình huống tạm, KHÁC thiếu quyền)", () => {
    const ds = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: null, canhBao: [] });
    expect(ds.find((h) => h.ma === "baoSuCo")?.lyDoChan).toBe("chua_chon_may");
  });

  it("★★★ HÀNH VI — có quyền ⇒ nút hiện; bấm ⇒ mở ô mô tả; gửi ⇒ `quickReport` đúng `machineId`", async () => {
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps()} />);
    const nut = screen.getByTestId("nut-bao-su-co");
    await nd.click(nut);
    await nd.type(screen.getByTestId("o-mo-ta-su-co"), "Băng tải kêu to");
    await nd.click(screen.getByTestId("nut-gui-su-co"));
    expect(guiSuCo).toHaveBeenCalledTimes(1);
    expect(guiSuCo.mock.calls[0][0]).toMatchObject({
      machineId: 42,
      description: "Băng tải kêu to",
    });
  });

  it("★★★ ĐỐI CHỨNG BIẾT KÊU — KHÔNG quyền tạo ⇒ 0 nút báo sự cố trong DOM", () => {
    render(<NganXuLy {...dungProps({ quyen: { ...QUYEN_DU, baoSuCo: false } })} />);
    expect(screen.queryByTestId("nut-bao-su-co")).toBeNull();
  });

  it("★ ẨN chứ KHÔNG disable — không có `disabled={!quyen.baoSuCo}` trong nguồn", () => {
    expect(NGAN).not.toMatch(/disabled=\{!\s*quyen\./);
  });

  it("★★★ CHỖ NỐI (G16) — `/twin` truyền `baoSuCo` lấy đúng tên module máy chủ dùng", () => {
    const i = TRANG.indexOf("const quyen: QuyenXuLy = {");
    expect(i).toBeGreaterThan(-1);
    const khoi = TRANG.slice(i, TRANG.indexOf("};", i));
    expect(khoi).toContain('baoSuCo: hasPermission("andon", "canCreate")');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ĐỢT 25 VIỆC 2 — GHI CHÚ XỬ LÝ                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */
/*
 * `nganXuLyLogic.ts` khai hành động `ghiChu` từ Task 9 và **chưa nối vào đâu**:
 * grep `NganXuLy.tsx` trước đợt này cho 0 kết quả `ghi-chu`. Máy chủ cũng chưa có
 * đường — thủ tục duy nhất nhận ghi chú là `andon.resolve`, và nó ĐÓNG cảnh báo
 * kèm GHI ĐÈ mô tả gốc (`andonService.ts:276`). Đợt này mở
 * `andon.ghiChu` + `andon.danhSachGhiChu` (bảng `andon_notes`, migration 0357).
 *
 * ⚠ Ô "ĐỐI CHỨNG MÁY CHỦ" đọc `andonRouter.ts` từ ĐĨA (G24): một nút client nối
 *   vào thủ tục sai cổng là đúng lớp lỗi "một lối vào rồi TỪ CHỐI" của Khối D.
 */

/** Một cảnh báo ĐANG MỞ cho ngăn xử lý (khác `CanhBaoDai` của dải cảnh báo). */
function cbMo(sua: Record<string, unknown> = {}) {
  return {
    id: 77,
    mucDo: "red",
    trangThai: "raised",
    tieuDe: "Kẹt phôi băng tải",
    raisedAt: BAY_GIO - 60_000,
    machineId: 42,
    ...sua,
  } as NganXuLyProps["canhBao"][number];
}

describe("★★★ ĐỢT 25 VIỆC 2 — ghi chú xử lý, KHÔNG đóng cảnh báo", () => {
  it("★ ĐỐI CHỨNG MÁY CHỦ — `ghiChu` CÓ THẬT và gác `andon`/canEdit (đọc từ đĩa)", () => {
    expect(ROUTER_ANDON).toContain("ghiChu: protectedProcedure");
    const i = ROUTER_ANDON.indexOf("ghiChu: protectedProcedure");
    expect(ROUTER_ANDON.slice(i, i + 200)).toContain('requirePermission("andon", "canEdit")');
  });

  it("★ ĐỐI CHỨNG MÁY CHỦ — `danhSachGhiChu` gác `andon`/canView (xem ≠ sửa)", () => {
    const i = ROUTER_ANDON.indexOf("danhSachGhiChu: protectedProcedure");
    expect(i).toBeGreaterThan(-1);
    expect(ROUTER_ANDON.slice(i, i + 200)).toContain('requirePermission("andon", "canView")');
  });

  it("★★★ ĐỐI CHỨNG MÁY CHỦ — `ghiChu` ghi vào `andonNotes`, KHÔNG gọi `resolveAndon`", () => {
    // Đây là cả lý do tồn tại của thủ tục mới. Nếu ai đó "đơn giản hoá" nó thành
    // một lời gọi `resolveAndon(id, user, note)` thì cảnh báo bị đóng và mô tả gốc
    // của người báo bị xoá — ô này phải ĐỎ ngay lúc đó.
    const i = ROUTER_ANDON.indexOf("ghiChu: protectedProcedure");
    const than = ROUTER_ANDON.slice(i, ROUTER_ANDON.indexOf("danhSachGhiChu: protectedProcedure", i));
    expect(than).toContain("insert(andonNotes)");
    expect(than).not.toContain("resolveAndon");
    expect(than).not.toContain("acknowledgeAndon");
  });

  it("★★★ bảng hành động: `ghiChu` theo quyền `andon`/canEdit, và cần CÓ cảnh báo", () => {
    const co = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: 7, canhBao: [cbMo()] });
    expect(co.find((h) => h.ma === "ghiChu")?.duocPhep).toBe(true);
    expect(co.find((h) => h.ma === "ghiChu")?.lyDoChan).toBeNull();

    const khong = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: 7, canhBao: [] });
    expect(khong.find((h) => h.ma === "ghiChu")?.lyDoChan).toBe("khong_co_canh_bao");
  });

  it("★★★ HÀNH VI — có quyền + có cảnh báo ⇒ nút hiện; bấm ⇒ mở ô; gửi ⇒ `ghiChu` đúng `id` cảnh báo", async () => {
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps({ canhBao: [cbMo({ id: 77 })] })} />);
    await nd.click(screen.getByTestId("nut-ghi-chu"));
    await nd.type(screen.getByTestId("o-ghi-chu"), "Đã kiểm cảm biến vào");
    await nd.click(screen.getByTestId("nut-gui-ghi-chu"));
    expect(guiGhiChu).toHaveBeenCalledTimes(1);
    expect(guiGhiChu.mock.calls[0][0]).toMatchObject({ id: 77, note: "Đã kiểm cảm biến vào" });
  });

  it("★★★ ô RỖNG ⇒ KHÔNG gọi mutation (client nói cùng câu với zod `min(1)` của server)", async () => {
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps({ canhBao: [cbMo()] })} />);
    await nd.click(screen.getByTestId("nut-ghi-chu"));
    await nd.type(screen.getByTestId("o-ghi-chu"), "   ");
    await nd.click(screen.getByTestId("nut-gui-ghi-chu"));
    expect(guiGhiChu).not.toHaveBeenCalled();
  });

  it("★★★ NHIỀU NGƯỜI MỘT SỰ CỐ — mở ô ⇒ thấy ghi chú CÓ SẴN, mỗi dòng kèm TÊN người ghi", async () => {
    // Đây là nghiệp vụ mà cả Việc 2 phục vụ. Một nút chỉ-ghi-không-đọc thì người
    // thứ hai không bao giờ thấy người thứ nhất đã thử gì.
    kho.dsGhiChu = [
      { id: 2, note: "Ca sau: đã thay dây curoa", createdBy: 9, createdAt: new Date(BAY_GIO - 60_000).toISOString(), tenNguoiGhi: "Trần B" },
      { id: 1, note: "Đã kiểm cảm biến vào", createdBy: 8, createdAt: new Date(BAY_GIO - 600_000).toISOString(), tenNguoiGhi: "Nguyễn A" },
    ];
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps({ canhBao: [cbMo()] })} />);
    await nd.click(screen.getByTestId("nut-ghi-chu"));
    const dong = screen.getAllByTestId(/^ghi-chu-\d+$/);
    expect(dong).toHaveLength(2);
    // ⚠ Đọc CHỮ người dùng nhìn thấy, không đọc testid.
    expect(dong[0]).toHaveTextContent("Ca sau: đã thay dây curoa");
    expect(dong[0]).toHaveTextContent("Trần B");
    expect(dong[1]).toHaveTextContent("Đã kiểm cảm biến vào");
    expect(dong[1]).toHaveTextContent("Nguyễn A");
  });

  it("★ ĐỐI CHỨNG BIẾT KÊU — danh sách RỖNG ⇒ 0 dòng và một câu nói ra sự rỗng (NT-3)", async () => {
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps({ canhBao: [cbMo()] })} />);
    await nd.click(screen.getByTestId("nut-ghi-chu"));
    expect(screen.queryAllByTestId(/^ghi-chu-\d+$/)).toHaveLength(0);
    expect(screen.getByTestId("ghi-chu-trong")).toBeInTheDocument();
  });

  it("★★★ NÓI RA rằng ghi chú KHÔNG đóng cảnh báo (cùng luật trung thực với `AnTamAlarm`)", async () => {
    const nd = userEvent.setup();
    render(<NganXuLy {...dungProps({ canhBao: [cbMo()] })} />);
    await nd.click(screen.getByTestId("nut-ghi-chu"));
    expect(screen.getByTestId("ghi-chu-khong-dong")).toHaveTextContent(/không đóng/i);
  });

  it("★★★ ĐỐI CHỨNG BIẾT KÊU — KHÔNG có `andon`/canEdit ⇒ 0 nút ghi chú trong DOM (ẨN, không disable)", () => {
    render(<NganXuLy {...dungProps({ canhBao: [cbMo()], quyen: { ...QUYEN_DU, ackAlarm: false } })} />);
    expect(screen.queryByTestId("nut-ghi-chu")).toBeNull();
  });

  it("★ có quyền nhưng KHÔNG có cảnh báo ⇒ nút HIỆN mà DISABLE (tình huống tạm, khác thiếu quyền)", () => {
    render(<NganXuLy {...dungProps({ canhBao: [] })} />);
    expect(screen.getByTestId("nut-ghi-chu")).toBeDisabled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* T10 — NGĂN XỬ LÝ HOẠT ĐỘNG TRÊN MÀN NHÀ MÁY                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ T10 — xử lý TẠI CHỖ từ dải cảnh báo, không rời `/twin`", () => {
  it("★★★ dòng cảnh báo CÓ máy ⇒ có nút xử lý tại chỗ, và nó KHÔNG phải dòng (đếm dòng giữ nguyên)", async () => {
    const nd = userEvent.setup();
    const onXuLy = vi.fn();
    render(
      <DaiCanhBao seed={[cb(), cb({ idNguon: 8, machineId: 43 })]} bayGio={BAY_GIO} onXuLyTaiCho={onXuLy} />,
    );
    // Bộ đếm dòng của mọi lưới cũ là `/^canh-bao-/` — nút mới KHÔNG được dính tiền tố đó.
    expect(screen.queryAllByTestId(/^canh-bao-/)).toHaveLength(2);
    await nd.click(screen.getByTestId("xu-ly-andon-7"));
    expect(onXuLy).toHaveBeenCalledTimes(1);
    expect(onXuLy.mock.calls[0][0]).toMatchObject({ idNguon: 7, machineId: 42 });
  });

  it("★★★ ĐỐI CHỨNG — cảnh báo KHÔNG gắn máy ⇒ KHÔNG có nút xử lý (không hứa thứ không làm được)", () => {
    render(<DaiCanhBao seed={[cb({ idNguon: 9, machineId: null })]} bayGio={BAY_GIO} onXuLyTaiCho={vi.fn()} />);
    expect(screen.queryAllByTestId(/^canh-bao-/)).toHaveLength(1);
    expect(screen.queryByTestId("xu-ly-andon-9")).toBeNull();
  });

  it("★ ĐỐI CHỨNG — tầng trên KHÔNG nối `onXuLyTaiCho` ⇒ 0 nút xử lý (không nút chết)", () => {
    render(<DaiCanhBao seed={[cb()]} bayGio={BAY_GIO} />);
    expect(screen.queryByTestId("xu-ly-andon-7")).toBeNull();
  });

  it("★★★ bấm DÒNG vẫn là đường cũ (QĐ-23: rời sang `/twin/may/:id`) — hai đường KHÔNG trộn", () => {
    // Đường rời trang được ghim nguyên văn ở `cuaVaoTwin.unit.test.ts`; ở đây chỉ
    // khẳng định trang KHÔNG đổi nó khi thêm đường thứ hai.
    expect(TRANG).toContain("onChonCanhBao={(c) => c.machineId != null && chonMay(c.machineId)}");
    expect(TRANG).toContain("dieuHuongToiMan(duongDanManMay(id))");
  });

  it("★★★ CHỖ NỐI (G16) — `/twin` giữ máy đang xử lý và TRUYỀN nó xuống `NganXuLy`", () => {
    expect(TRANG).toMatch(/onXuLyTaiCho=\{/);
    expect(TRANG).toContain("setMayXuLy");
    expect(TRANG).toMatch(/machineId=\{machineIdNgan\}/);
  });

  it("★★★ HÀNH VI — có máy xử lý + quyền ⇒ ngăn render nút hành động; KHÔNG máy ⇒ `ngan-chua-chon` và 0 nút", () => {
    const { unmount } = render(<NganXuLy {...dungProps({ machineId: 42 })} />);
    expect(screen.getByTestId("nut-ack")).toBeInTheDocument();
    expect(screen.getByTestId("nut-bao-su-co")).toBeInTheDocument();
    unmount();
    render(<NganXuLy {...dungProps({ machineId: null })} />);
    expect(screen.getByTestId("ngan-chua-chon")).toBeInTheDocument();
    for (const t of ["nut-ack", "nut-bao-su-co", "nut-tao-phieu", "nut-an-tam"]) {
      expect(screen.queryByTestId(t), t).toBeNull();
    }
  });

  it("★ đóng được ngăn xử lý — nếu không, panel che cảnh 3D vĩnh viễn", async () => {
    const nd = userEvent.setup();
    const dong = vi.fn();
    render(<NganXuLy {...dungProps({ onDongNgan: dong })} />);
    await nd.click(screen.getByTestId("nut-dong-ngan"));
    expect(dong).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* T11 — ĐÍCH CẤP NHÀ MÁY                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ T11 — `loaiDich` có chỗ gọi thật, và đích cấp nhà máy ĐỌC được tham số", () => {
  it("★★★ cấp NHÀ MÁY + chưa chọn máy ⇒ ngăn VẪN render nhóm §9.3 với đích cấp nhà máy", () => {
    render(
      <NganXuLy {...dungProps({ machineId: null, loaiDich: "factory", dichId: 41 })} />,
    );
    expect(screen.getByTestId("nhom-mo-chuc-nang")).toBeInTheDocument();
    const nut = screen.getAllByTestId(/^nut-dieu-huong-/);
    expect(nut.length).toBeGreaterThanOrEqual(2);
  });

  it("★★★ ĐỐI CHỨNG — cấp máy (mặc định) + chưa chọn máy ⇒ KHÔNG nhóm §9.3 (hành vi cũ giữ nguyên)", () => {
    render(<NganXuLy {...dungProps({ machineId: null })} />);
    expect(screen.queryByTestId("nhom-mo-chuc-nang")).toBeNull();
    expect(screen.getByTestId("ngan-chua-chon")).toBeInTheDocument();
  });

  it("★ ĐỐI CHỨNG — thiếu `canView` của màn đích ⇒ nút ẩn (không dựng lối vào rồi TỪ CHỐI)", () => {
    render(
      <NganXuLy
        {...dungProps({ machineId: null, loaiDich: "factory", dichId: 41, coQuyenXem: () => false })}
      />,
    );
    expect(screen.queryAllByTestId(/^nut-dieu-huong-/)).toHaveLength(0);
  });

  it("★★★ CHỖ NỐI (G16) — `/twin` TRUYỀN `loaiDich`/`dichId` theo cấp đang chọn", () => {
    expect(TRANG).toMatch(/loaiDich=\{/);
    expect(TRANG).toMatch(/dichId=\{/);
    expect(TRANG).toContain("const dichNgan");
  });

  it("★★★ NỬA SAU CỦA BẢN VÁ — `nganPhaiTrong` thôi coi 'không có máy' là 'rỗng'", () => {
    // Vá `NganXuLy` mà để điều kiện cũ thì nhóm §9.3 mới được render vào một
    // `aside` mang `hidden` + `w-0`: đúng lớp lỗi G16 lặp lại ở tầng CSS.
    expect(TRANG).toContain("const nganPhaiTrong = machineIdNgan === null && dichNgan === null;");
    expect(TRANG).not.toContain("const nganPhaiTrong = machineIdChon === null;");
  });

  it("★★★ ĐO NGUỒN, KHÔNG ĐOÁN — `/andon` và `/production-dashboard` ĐỌC `factoryId`", () => {
    expect(MAN_ANDON).toContain('useScope(["factory", "line"])');
    expect(MAN_SAN_XUAT).toContain('useScope(["factory", "line"])');
  });

  it("★★★ VÌ SAO KHÔNG có `/oee-dashboard` ở cấp nhà máy: màn ấy KHÔNG đọc `factoryId`", () => {
    // Kế hoạch đề nghị thêm `/oee-dashboard` vào đích cấp nhà máy. Đo nguồn:
    // `OEEDashboard` khai `useScope(["line","machine"])` ⇒ `?factoryId=` bị BỎ
    // trong im lặng (G67). Một nút mang tham số không ai đọc là lời hứa hỏng.
    expect(MAN_OEE).toContain('useScope(["line", "machine"])');
    expect(MAN_OEE).not.toContain('useScope(["factory"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NP — NHÃN PHẠM VI CHO HAI CON SỐ LỆCH                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ NP — hai con số nói rõ mẫu số của mình (không đổi cách đếm)", () => {
  it("★★★ dải cảnh báo in nhãn phạm vi ĐỌC ĐƯỢC, không phải thuộc tính dữ liệu", () => {
    render(
      <DaiCanhBao
        seed={[cb(), cb({ idNguon: 8 })]}
        bayGio={BAY_GIO}
        nhanPhamVi="đếm trên toàn phạm vi tài khoản"
      />,
    );
    const o = screen.getByTestId("dai-pham-vi");
    expect(o).toBeInTheDocument();
    expect(o.textContent).toContain("toàn phạm vi tài khoản");
  });

  it("★ ĐỐI CHỨNG — không truyền nhãn ⇒ KHÔNG in một dòng trống", () => {
    render(<DaiCanhBao seed={[cb()]} bayGio={BAY_GIO} />);
    expect(screen.queryByTestId("dai-pham-vi")).toBeNull();
  });

  it("★★★ CHỖ NỐI — `/twin` tính nhãn HAI CA: có nhánh ⇒ tên nhánh; không ⇒ toàn phạm vi tài khoản", () => {
    expect(TRANG).toContain("const nhanPhamViCanhBao");
    expect(TRANG).toMatch(/nhanPhamVi=\{nhanPhamViCanhBao\}/);
    expect(TRANG).toContain("twin3d.daiCanhBao.phamViTaiKhoan");
    expect(TRANG).toContain("twin3d.daiCanhBao.phamViNhanh");
  });

  it("★★★ CHỖ NỐI — hàng tổng quan panel trái NÓI RA rằng nó đếm theo nhà máy", () => {
    expect(TRANG).toContain('data-testid="tong-quan-pham-vi"');
    expect(TRANG).toContain("twin3d.vanHanh.demTheoNhaMay");
  });

  it("★★★ KHÔNG ĐỔI CÁCH ĐẾM — `dem-may` vẫn là `mayVanHanh.length`, dải vẫn `theoPhamVi.length`", () => {
    const i = TRANG.indexOf('data-testid="dem-may"');
    expect(i).toBeGreaterThan(-1);
    expect(TRANG.slice(i, i + 160)).toContain("hienSo(mayVanHanh.length, dangTai)");
    expect(DAI).toContain('const nhanTong = chuaDo ? "—" : String(theoPhamVi.length);');
  });
});
