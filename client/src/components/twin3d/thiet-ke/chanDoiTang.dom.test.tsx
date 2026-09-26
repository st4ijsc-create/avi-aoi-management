// @vitest-environment jsdom
//
/**
 * chanDoiTang.dom.test.tsx — ★★★ H1: ĐỔI TẦNG KHI CÒN THAY ĐỔI CHƯA LƯU
 * KHÔNG ĐƯỢC LÀM MẤT VIỆC CỦA NGƯỜI DÙNG TRONG IM LẶNG.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC ĐO SỐNG (vòng 2), KHÔNG PHẢI SUY ĐOÁN
 * ════════════════════════════════════════════════════════════════════════════
 * Trong `/twin-studio`: bật Lock trên một khối ⇒ màn hiện *"1 unsaved changes"*.
 * **Đổi tầng ⇒ đếm về 0, KHÔNG hộp thoại, KHÔNG toast, quay lại tầng cũ KHÔNG
 * khôi phục.** Nguyên nhân: `<XuongThietKe key={tangId}>` — `key` đổi ⇒ React
 * remount ⇒ buffer `datChoSua` bị vứt.
 *
 * ⚠ VÀ `key` LÀ CẦN THIẾT: thiếu nó, hàng của tầng CŨ còn trong buffer và một
 *   lần "Lưu" sẽ ghi nhầm sang tầng ĐANG CHỌN — nguy hiểm hơn hẳn mất buffer.
 *   Tác giả tự khai nợ này ở `TwinStudio.tsx` (docblock cạnh `key=`).
 *
 * ⇒ Bản vá KHÔNG được gỡ `key`. Nó chặn lượt đổi TRƯỚC khi remount xảy ra và
 *   hỏi người dùng; mọi lượt `luu()` vì thế vẫn chạy khi `XuongThietKe` còn
 *   mounted với `tangId` CŨ. Ca `luu() chạy trong lúc màn còn ở tầng cũ` dưới
 *   đây ghim đúng tính chất ấy — nó là phép đo chống "vá xong đẻ ra lỗi ghi
 *   nhầm tầng".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO Ở ĐÂU — VÀ VÌ SAO TỆP NẰM TRONG `twin3d/`
 * ════════════════════════════════════════════════════════════════════════════
 * Chỗ hỏng là CHỖ NỐI giữa `TwinStudio` (ba ô chọn) và `XuongThietKe` (buffer),
 * nên phép đo phải chạy qua `TwinStudio` THẬT + `BoChonNapUI` THẬT. Chỉ
 * `XuongThietKe` bị mock — nó kéo cả R3F/three vào jsdom, và cái nó phải làm
 * (báo LÊN số thay đổi chưa lưu) là một hợp đồng PROP, đo được bằng mock.
 *   Mock ấy KHÔNG che được thứ đang đo: nếu `TwinStudio` không truyền
 * `onThayDoiChuaLuu` thì mock không có gì để gọi, hộp thoại không bao giờ hiện,
 * và mọi ca H1 ĐỎ. Nửa còn lại (`XuongThietKe` có THẬT SỰ gọi prop ấy không)
 * đo bằng mã nguồn trên đĩa ở khối ⑦ — cùng khuôn `quyenXuong.unit.test.ts`.
 *
 * ★ Tệp đặt trong `components/twin3d/thiet-ke/` để nằm trong cổng
 *   `npx vitest run client/src/components/twin3d` (cổng của đợt này).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { resolve } from "node:path";
import { docMaNguon } from "@shared/testing/docMaNguon";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bệ đỡ                                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

// jsdom không có `ResizeObserver`; `useTruDinhKhung` (mã THẬT, giữ trong đường
// đo) dùng nó. Stub tối thiểu — không mock cả hook để không mất mã thật.
class RoGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RoGia;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, macDinh?: unknown, bien?: Record<string, unknown>) => {
      const md = typeof macDinh === "string" ? macDinh : k;
      const b = typeof macDinh === "object" && macDinh !== null ? (macDinh as Record<string, unknown>) : bien;
      let s = md;
      if (b) for (const [kk, v] of Object.entries(b)) s = s.replace(`{{${kk}}}`, String(v));
      return s;
    },
  }),
}));

/* ⚠ `vi.mock` được HOIST lên đầu tệp ⇒ hằng dùng trong factory phải qua `vi.hoisted`. */
const { NHA_MAY, TOA_NHA, TANG } = vi.hoisted(() => ({
  NHA_MAY: [{ id: 1, name: "Nhà máy A" }],
  TOA_NHA: [
    { id: 11, ten: "Toà 1", rongMm: "38400", sauMm: "29600" },
    { id: 12, ten: "Toà 2", rongMm: "20000", sauMm: "10000" },
  ],
  TANG: [
    { id: 81, capSo: 1, ten: "Tầng 1" },
    { id: 82, capSo: 2, ten: "Tầng 2" },
  ],
}));

/**
 * ★★★ V-14(2) — DANH SÁCH TẦNG PHẢI ĐỔI ĐƯỢC GIỮA CHỪNG.
 *   Lỗi đang đo là "một lượt nạp lại NỀN làm tầng đang mở biến mất", nên mock
 *   trả hằng số thì không có cách nào dựng lại nó. `kho.dsTang` là chỗ ca đo
 *   thay danh sách; `beforeEach` trả nó về mặc định.
 */
const khoTang = vi.hoisted(() => ({ ds: null as null | Array<Record<string, unknown>> }));

vi.mock("@/lib/trpc", () => {
  const tv = (data: unknown) => () => ({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      factory: { list: { useQuery: tv(NHA_MAY) } },
      twinCanh: {
        danhSachToaNha: { useQuery: tv(TOA_NHA) },
        chiTietToaNha: {
          useQuery: () => ({
            data: { tangs: khoTang.ds ?? TANG },
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
          }),
        },
        canhThietKe: { useQuery: tv(undefined) },
      },
    },
  };
});

/**
 * Toast — `TwinStudio` dùng kit `sonner` như phần còn lại của `twin3d/thiet-ke`.
 * Bắt lời khai ở đây để đo THEO NGHĨA (câu người dùng đọc), không theo testid.
 */
const toastGia = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastGia }));

vi.mock("@/components/PermissionGate", () => ({
  useCanWrite: () => ({
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canExport: true,
    readOnly: false,
  }),
}));

/* Hai tab kia không nằm trong đường đo của H1 và kéo theo form/CAD nặng. */
vi.mock("@/components/twin3d/thiet-ke/DungNhaXuong", () => ({
  default: () => <div data-testid="dung-nha-xuong-gia" />,
}));
vi.mock("@/components/twin3d/thiet-ke/NhapBanVe", () => ({
  default: () => <div data-testid="nhap-ban-ve-gia" />,
}));

/*
 * ★ `XuongThietKe` GIẢ — ranh giới đúng để giả (R3F/three không chạy trong
 *   jsdom). Nó ghi lại props để ca đo hỏi "lúc `luu()` chạy, màn đang ở tầng
 *   nào" — câu hỏi duy nhất phân biệt bản vá đúng với bản vá ghi nhầm tầng.
 */
const kho = vi.hoisted(() => ({
  tangDangDung: null as number | null,
  soLanDung: 0,
  bao: null as null | ((t: { so: number; luu: () => Promise<boolean> }) => void),
}));

vi.mock("@/components/twin3d/thiet-ke/XuongThietKe", () => ({
  default: (p: {
    tangId: number | null;
    onThayDoiChuaLuu?: (t: { so: number; luu: () => Promise<boolean> }) => void;
  }) => {
    kho.tangDangDung = p.tangId;
    kho.soLanDung += 1;
    kho.bao = p.onThayDoiChuaLuu ?? null;
    /*
     * ★★★ LƯỢT DỌN KHI THÁO — MOCK PHẢI TRUNG THÀNH ĐÚNG CHỖ NÀY.
     *   Mã thật dọn lời khai về 0 khi bị tháo (`XuongThietKe.tsx:607`), và
     *   React chạy lượt dọn của CON **trước** hiệu ứng của CHA. Một bản vá đọc
     *   `refChuaLuu` trong `useEffect` của `TwinStudio` vì thế luôn thấy **0**
     *   và cảnh báo V-14(2) không bao giờ kêu — mock không có lượt dọn này sẽ
     *   CHE mất đúng cái bẫy ấy và cho một lưới xanh giả.
     */
    useEffect(() => () => p.onThayDoiChuaLuu?.({ so: 0, luu: async () => true }), []);
    return <div data-testid="xuong-gia" data-tang-id={String(p.tangId)} />;
  },
}));

import TwinStudio from "@/pages/TwinStudio";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bệ thử                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Số lần `luu()` chạy, và TẦNG màn đang dựng tại đúng khoảnh khắc ấy. */
let nhatKyLuu: Array<{ tangLucLuu: number | null }> = [];

function luuGia(ketQua: boolean) {
  return vi.fn(async () => {
    nhatKyLuu.push({ tangLucLuu: kho.tangDangDung });
    return ketQua;
  });
}

/** Giả lập `XuongThietKe` báo lên "còn N thay đổi chưa lưu". */
function coThayDoi(so: number, luu: () => Promise<boolean>) {
  expect(kho.bao, "TwinStudio PHẢI truyền `onThayDoiChuaLuu` xuống XuongThietKe").not.toBeNull();
  act(() => kho.bao!({ so, luu }));
}

function oTang() {
  return screen.getByTestId("chon-tang") as HTMLSelectElement;
}
function doiTang(id: number) {
  fireEvent.change(oTang(), { target: { value: String(id) } });
}
function tangDangVe(): number | null {
  const el = screen.queryByTestId("xuong-gia");
  if (!el) return null;
  const v = el.getAttribute("data-tang-id");
  return v === null || v === "null" ? null : Number(v);
}

/**
 * Bấm một TAB như người dùng thật.
 *
 * ⚠ Radix kích hoạt tab ở **`mousedown`** (và ở `focus` khi
 *   `activationMode="automatic"`), KHÔNG ở `click`. Một `fireEvent.click` trần
 *   sẽ không đổi tab nào và mọi ca dưới đây sẽ "xanh" vì không có gì xảy ra —
 *   đúng khuôn âm-tính-giả ở THIẾT BỊ ĐO. Gửi cả hai cho giống lượt bấm thật.
 */
function bamTab(testid: string) {
  const el = screen.getByTestId(testid);
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.click(el);
}

/** Testid của tab ĐANG MỞ — đọc `data-state="active"` mà Radix đặt trên trigger. */
function tabDangMo(): string | null {
  const bat = document.querySelector('[role="tab"][data-state="active"]');
  return bat === null ? null : bat.getAttribute("data-testid");
}

/** Xưởng còn dựng trong cây hay đã bị tháo (bị tháo = buffer đã mất). */
function xuongConDung(): boolean {
  return document.querySelector('[data-testid="xuong-gia"]') !== null;
}

beforeEach(() => {
  nhatKyLuu = [];
  kho.tangDangDung = null;
  kho.soLanDung = 0;
  kho.bao = null;
  khoTang.ds = null;
  toastGia.warning.mockClear();
  toastGia.error.mockClear();
  toastGia.success.mockClear();
  toastGia.info.mockClear();
});
afterEach(() => cleanup());

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ① Nền — màn dựng được, ô chọn tầng CÓ THẬT hai mục                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("① nền — G5: dữ liệu KHÁC RỖNG, ô chọn tầng có ≥ 2 mục để đổi", () => {
  it("dựng xưởng ở tầng đầu và ô `chon-tang` có 2 mục", () => {
    render(<TwinStudio />);
    expect(screen.getByTestId("xuong-gia")).toBeInTheDocument();
    expect(tangDangVe()).toBe(81);
    expect(oTang().getAttribute("data-so-muc")).toBe("2");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ② H1 — CÒN THAY ĐỔI CHƯA LƯU ⇒ KHÔNG MẤT IM LẶNG                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② H1 — còn thay đổi chưa lưu + đổi tầng ⇒ KHÔNG mất im lặng", () => {
  it("★★★ hộp thoại HIỆN và tầng KHÔNG đổi ngay (buffer chưa bị vứt)", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    const lanDungTruoc = kho.soLanDung;

    doiTang(82);

    expect(screen.getByTestId("hop-thoai-chua-luu")).toBeInTheDocument();
    // ★ Điểm sống còn: `XuongThietKe` KHÔNG được remount ⇒ buffer còn nguyên.
    expect(tangDangVe()).toBe(81);
    expect(nhatKyLuu).toHaveLength(0);
    // Không remount = không dựng lại với tangId mới.
    expect(kho.tangDangDung).toBe(81);
    expect(kho.soLanDung).toBeGreaterThanOrEqual(lanDungTruoc);
  });

  it("★★★ hộp thoại NÓI SỐ thay đổi sắp mất — không phải một câu chung chung", () => {
    render(<TwinStudio />);
    coThayDoi(3, luuGia(true));
    doiTang(82);
    expect(screen.getByTestId("hop-thoai-chua-luu")).toHaveTextContent("3");
  });

  it("★★★ ba lựa chọn PHẢI có mặt: Lưu · Bỏ · Huỷ (thiếu Huỷ = vẫn ép người dùng)", () => {
    render(<TwinStudio />);
    coThayDoi(1, luuGia(true));
    doiTang(82);
    expect(screen.getByTestId("nut-luu-roi-doi")).toBeInTheDocument();
    expect(screen.getByTestId("nut-bo-thay-doi")).toBeInTheDocument();
    expect(screen.getByTestId("nut-huy-doi")).toBeInTheDocument();
  });

  it("★★★ HUỶ ⇒ ở lại tầng cũ, hộp thoại đóng, không lưu, không mất gì", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    doiTang(82);
    fireEvent.click(screen.getByTestId("nut-huy-doi"));
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tangDangVe()).toBe(81);
    expect(nhatKyLuu).toHaveLength(0);
  });

  it("★★★ BỎ THAY ĐỔI ⇒ sang tầng mới, và người dùng ĐÃ BIẾT mình bỏ gì", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    doiTang(82);
    fireEvent.click(screen.getByTestId("nut-bo-thay-doi"));
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tangDangVe()).toBe(82);
    expect(nhatKyLuu).toHaveLength(0); // "Bỏ" thì KHÔNG được lén ghi
  });

  it("★★★ LƯU RỒI ĐỔI ⇒ `luu()` chạy TRONG LÚC màn còn ở tầng CŨ, rồi mới sang tầng mới", async () => {
    // ⚠ Đây là ca chống lớp lỗi NGUY HIỂM HƠN mà `key` đang giữ: nếu bản vá đổi
    //   tầng trước rồi mới lưu, buffer của tầng cũ sẽ ghi xuống tầng MỚI.
    render(<TwinStudio />);
    const luu = luuGia(true);
    coThayDoi(2, luu);
    doiTang(82);
    await act(async () => {
      fireEvent.click(screen.getByTestId("nut-luu-roi-doi"));
    });
    expect(luu).toHaveBeenCalledTimes(1);
    expect(nhatKyLuu).toEqual([{ tangLucLuu: 81 }]); // ★ tầng CŨ, không phải 82
    expect(tangDangVe()).toBe(82);
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
  });

  it("★★★ LƯU THẤT BẠI ⇒ KHÔNG đổi tầng (nếu đổi thì vẫn là mất im lặng)", async () => {
    render(<TwinStudio />);
    const luu = luuGia(false);
    coThayDoi(2, luu);
    doiTang(82);
    await act(async () => {
      fireEvent.click(screen.getByTestId("nut-luu-roi-doi"));
    });
    expect(luu).toHaveBeenCalledTimes(1);
    expect(tangDangVe()).toBe(81);
    expect(screen.getByTestId("hop-thoai-chua-luu")).toBeInTheDocument();
  });

  it("★★★ ĐỔI TOÀ NHÀ cũng đổi tầng ⇒ cũng phải hỏi (cùng một mất mát, khác lối vào)", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    fireEvent.change(screen.getByTestId("chon-toa-nha"), { target: { value: "12" } });
    expect(screen.getByTestId("hop-thoai-chua-luu")).toBeInTheDocument();
    expect(tangDangVe()).toBe(81);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ③ ĐỐI CHỨNG — không còn thay đổi thì KHÔNG được hỏi                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ đối chứng — KHÔNG còn thay đổi ⇒ đổi tầng MƯỢT, không hỏi", () => {
  it("★★★ chưa từng báo thay đổi nào ⇒ đổi tầng đi thẳng", () => {
    render(<TwinStudio />);
    doiTang(82);
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tangDangVe()).toBe(82);
  });

  it("★★★ đã báo 2 rồi báo về 0 (vừa Lưu xong) ⇒ đổi tầng đi thẳng", () => {
    // Nếu bản vá chốt cờ "đã từng có thay đổi" thay vì đọc SỐ HIỆN TẠI, ca này đỏ.
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    coThayDoi(0, luuGia(true));
    doiTang(82);
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tangDangVe()).toBe(82);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ④ SAU KHI ĐỔI — cửa chặn phải TỰ ĐÓNG LẠI, không kẹt vĩnh viễn              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ không kẹt — sang tầng mới rồi, tầng mới sạch thì đổi tiếp mượt", () => {
  it("Bỏ thay đổi → sang tầng 82 → (tầng mới báo 0) → đổi về 81 không hỏi", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    doiTang(82);
    fireEvent.click(screen.getByTestId("nut-bo-thay-doi"));
    expect(tangDangVe()).toBe(82);
    // Bản dựng mới của xưởng báo 0 thay đổi — đúng như `XuongThietKe` làm khi mount.
    coThayDoi(0, luuGia(true));
    doiTang(81);
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tangDangVe()).toBe(81);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑤ V-14(1) — ĐỔI TAB: CÙNG LỚP LỖI, KHÁC CỬA VÀO                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Radix `Tabs` **UNMOUNT** nội dung tab không hoạt động (`TwinStudio.tsx` cố ý
 * dựa vào điều đó cho RB-4: một WebGL context sống tại một thời điểm). Hệ quả
 * chưa ai chặn: bấm sang tab khác trong lúc còn thay đổi chưa lưu thì
 * `XuongThietKe` bị tháo ⇒ buffer `datChoSua` bị vứt — **cùng một mất mát với
 * đổi tầng, chỉ khác cửa vào** (QA lần 11, V-14 số 1).
 *
 * ★ Ca "không có thay đổi" dưới đây kiêm CA DƯƠNG của cơ chế: nó ghim rằng đổi
 *   tab THẬT SỰ tháo xưởng. Thiếu nó thì ba ca kia có thể xanh chỉ vì lượt bấm
 *   không làm gì cả.
 */
describe("★★★ ⑤ V-14(1) — đổi TAB khi còn thay đổi chưa lưu ⇒ KHÔNG mất im lặng", () => {
  it("★★★ còn thay đổi chưa lưu ⇒ bấm tab khác PHẢI hỏi, KHÔNG đổi ngay", () => {
    render(<TwinStudio />);
    coThayDoi(1, luuGia(true));

    bamTab("tab-con-duong-b");

    expect(screen.getByTestId("hop-thoai-chua-luu")).toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-thiet-ke");
    // ★ Điểm sống còn: xưởng KHÔNG bị tháo ⇒ buffer còn nguyên để mà Lưu.
    expect(xuongConDung()).toBe(true);
    expect(nhatKyLuu).toHaveLength(0);
  });

  it("★★★ CA DƯƠNG — không có thay đổi ⇒ đổi tab mượt, và xưởng BỊ THÁO thật", () => {
    render(<TwinStudio />);
    expect(xuongConDung()).toBe(true);

    bamTab("tab-con-duong-b");

    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-con-duong-b");
    // ★ Đây là cơ chế mất dữ liệu, đo được: đổi tab = tháo xưởng = vứt buffer.
    expect(xuongConDung()).toBe(false);
  });

  it("★★★ 'Ở lại' ⇒ giữ tab cũ, không lưu, và 2 thay đổi VẪN CÒN NGUYÊN", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));

    bamTab("tab-con-duong-a");
    fireEvent.click(screen.getByTestId("nut-huy-doi"));

    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-thiet-ke");
    expect(xuongConDung()).toBe(true);
    expect(nhatKyLuu).toHaveLength(0);
    // ★ "Vẫn còn nguyên" đo bằng lượt hỏi THỨ HAI nói lại ĐÚNG con số 2 — không
    //   phải bằng một cờ nội bộ mà lưới tự bịa ra.
    bamTab("tab-con-duong-a");
    expect(screen.getByTestId("hop-thoai-chua-luu")).toHaveTextContent("2");
  });

  it("★★★ LƯU RỒI CHUYỂN qua lối TAB ⇒ `luu()` chạy lúc xưởng CÒN dựng, rồi mới đổi tab", async () => {
    // ⚠ Cùng lớp chống lỗi "ghi nhầm tầng" của ca đổi tầng: nếu bản vá đổi tab
    //   trước rồi mới lưu, `luu()` chạy sau khi xưởng đã bị tháo — lượt ghi của
    //   một bản dựng đã chết.
    render(<TwinStudio />);
    const conDungLucLuu: boolean[] = [];
    const luu = vi.fn(async () => {
      conDungLucLuu.push(xuongConDung());
      return true;
    });
    coThayDoi(2, luu);

    bamTab("tab-con-duong-b");
    await act(async () => {
      fireEvent.click(screen.getByTestId("nut-luu-roi-doi"));
    });

    expect(luu).toHaveBeenCalledTimes(1);
    expect(conDungLucLuu).toEqual([true]); // ★ còn dựng ⇒ ghi đúng mặt sàn đang mở
    expect(tabDangMo()).toBe("tab-con-duong-b");
    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
  });

  it("★★★ LƯU THẤT BẠI ⇒ KHÔNG đổi tab (đổi thì vẫn là mất im lặng)", async () => {
    render(<TwinStudio />);
    const luu = luuGia(false);
    coThayDoi(2, luu);

    bamTab("tab-con-duong-b");
    await act(async () => {
      fireEvent.click(screen.getByTestId("nut-luu-roi-doi"));
    });

    expect(luu).toHaveBeenCalledTimes(1);
    expect(tabDangMo()).toBe("tab-thiet-ke");
    expect(xuongConDung()).toBe(true);
    expect(screen.getByTestId("hop-thoai-chua-luu")).toBeInTheDocument();
  });

  it("★★★ BỎ THAY ĐỔI ⇒ sang tab kia, và KHÔNG lén ghi", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));

    bamTab("tab-con-duong-b");
    fireEvent.click(screen.getByTestId("nut-bo-thay-doi"));

    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-con-duong-b");
    expect(nhatKyLuu).toHaveLength(0);
  });

  it("★ ĐỐI CHỨNG — bấm lại CHÍNH tab đang mở thì KHÔNG hỏi (cổng không được kêu oan)", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));

    bamTab("tab-thiet-ke");

    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-thiet-ke");
  });

  it("★ KHÔNG KẸT — bỏ thay đổi sang tab kia rồi quay về tab Thiết kế vẫn mượt", () => {
    render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    bamTab("tab-con-duong-b");
    fireEvent.click(screen.getByTestId("nut-bo-thay-doi"));
    expect(tabDangMo()).toBe("tab-con-duong-b");

    // Xưởng đã tháo ⇒ mã thật báo lên `{ so: 0 }` ở lượt dọn; giả lập đúng thế.
    coThayDoi(0, luuGia(true));
    bamTab("tab-thiet-ke");

    expect(screen.queryByTestId("hop-thoai-chua-luu")).not.toBeInTheDocument();
    expect(tabDangMo()).toBe("tab-thiet-ke");
    expect(xuongConDung()).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑥ V-14(2) — TẦNG ĐANG MỞ BIẾN MẤT SAU MỘT LƯỢT NẠP LẠI NỀN                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lối mất dữ liệu THỨ BA: không ai bấm gì cả. Một lượt nạp lại nền trả danh
 * sách tầng mới thiếu tầng đang mở ⇒ `giaiNapThietKe` rơi về tầng đầu ⇒ `key`
 * đổi ⇒ xưởng remount ⇒ buffer bị vứt — **không đi qua `xinDoiNap`**, nên hộp
 * thoại ba nút không cứu được. Ở đây chỉ còn cách NÓI CHO NGƯỜI DÙNG BIẾT.
 *
 * ⚠ Phép đo này chỉ có nghĩa nhờ lượt dọn của mock (`{ so: 0 }` khi tháo). Nó
 *   tái hiện đúng thứ tự React chạy hiệu ứng: con dọn TRƯỚC, cha chạy SAU. Một
 *   bản vá đọc số thay đổi trong `useEffect` của cha sẽ thấy 0 và im lặng.
 */
describe("★★★ ⑥ V-14(2) — tầng đang mở biến mất ⇒ PHẢI cảnh báo, không im lặng", () => {
  /** Toàn bộ chữ đã nói ra qua toast cảnh báo, gộp lại để đo theo NGHĨA. */
  function loiCanhBao(): string {
    return toastGia.warning.mock.calls.map((c) => String(c[0])).join(" | ");
  }

  it("★★★ đang ở tầng 82 + còn 2 thay đổi, tầng 82 biến mất ⇒ CÓ cảnh báo, nói rõ mất gì", () => {
    const { rerender } = render(<TwinStudio />);
    doiTang(82); // người dùng CHỌN tầng 82 (ý muốn có thật, không phải mặc định)
    expect(tangDangVe()).toBe(82);
    coThayDoi(2, luuGia(true));

    // Một lượt nạp lại NỀN: danh sách mới không còn tầng 82.
    khoTang.ds = [TANG[0]];
    rerender(<TwinStudio />);

    // Rơi về tầng đầu là hành vi đúng — nhưng không được im lặng.
    expect(tangDangVe()).toBe(81);
    expect(toastGia.warning).toHaveBeenCalledTimes(1);
    expect(loiCanhBao()).toMatch(/không còn/i);
    expect(loiCanhBao()).toMatch(/chưa lưu/i);
  });

  it("★★★ CA ÂM — tầng biến mất nhưng KHÔNG có thay đổi nào ⇒ KHÔNG kêu (không mất gì)", () => {
    const { rerender } = render(<TwinStudio />);
    doiTang(82);
    coThayDoi(0, luuGia(true));

    khoTang.ds = [TANG[0]];
    rerender(<TwinStudio />);

    expect(tangDangVe()).toBe(81);
    expect(toastGia.warning).not.toHaveBeenCalled();
  });

  it("★★★ CA ÂM — danh sách đổi nhưng tầng đang mở VẪN CÒN ⇒ KHÔNG kêu", () => {
    const { rerender } = render(<TwinStudio />);
    doiTang(82);
    coThayDoi(2, luuGia(true));

    // Thêm một tầng mới; tầng 82 vẫn ở đó ⇒ không có lượt rơi nào.
    khoTang.ds = [...TANG, { id: 83, capSo: 3, ten: "Tầng 3" }];
    rerender(<TwinStudio />);

    expect(tangDangVe()).toBe(82);
    expect(toastGia.warning).not.toHaveBeenCalled();
  });

  it("★★★ CA ÂM — mở màn lần đầu (chưa chọn tầng nào) KHÔNG phải một lượt rơi", () => {
    const { rerender } = render(<TwinStudio />);
    coThayDoi(2, luuGia(true));
    rerender(<TwinStudio />);
    expect(toastGia.warning).not.toHaveBeenCalled();
  });

  it("★★★ KÊU ĐÚNG MỘT LẦN — nạp lại nền tiếp mà người dùng chưa chọn lại thì không kêu nữa", () => {
    const { rerender } = render(<TwinStudio />);
    doiTang(82);
    coThayDoi(2, luuGia(true));

    khoTang.ds = [TANG[0]];
    rerender(<TwinStudio />);
    rerender(<TwinStudio />);
    rerender(<TwinStudio />);

    // Một lượt mất dữ liệu = một câu cảnh báo. Kêu mỗi nhịp render là một cách
    // khác để người dùng thôi đọc cảnh báo.
    expect(toastGia.warning).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑦ NỬA CÒN LẠI CỦA CHỖ NỐI — đo trên MÃ THẬT trên ĐĨA                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

const GOC = process.cwd();
const XUONG = docMaNguon(resolve(GOC, "client/src/components/twin3d/thiet-ke/XuongThietKe.tsx"));
const STUDIO = docMaNguon(resolve(GOC, "client/src/pages/TwinStudio.tsx"));

describe("★★★ ⑦ chỗ nối THẬT — mock ở trên không được che nửa `XuongThietKe`", () => {
  it("★★★ `XuongThietKe` BÁO LÊN số thay đổi chưa lưu (không chỉ hiện badge cho mình)", () => {
    expect(XUONG).toContain("onThayDoiChuaLuu");
    /*
     * ⚠ Bản đầu của ca này viết `/onThayDoiChuaLuu[\s\S]{0,400}thayDoi\.length/`
     *   và ABLATION BÁC BỎ NÓ: thay cả hiệu ứng báo bằng `void onThayDoiChuaLuu;`
     *   vẫn XANH, vì `thayDoi.length` của hiệu ứng `beforeunload` ngay dưới lọt
     *   vào cửa sổ 400 ký tự. Một chỉ báo không biết KÊU trên ca dương đã biết
     *   thì nó không đo gì. Ghim ĐÚNG lượt gọi, kèm ĐÚNG con số.
     */
    expect(XUONG).toMatch(/onThayDoiChuaLuu\?\.\(\{\s*so:\s*thayDoi\.length/);
  });

  it("★★★ `XuongThietKe` DỌN lời khai về 0 KHI BỊ THÁO — khối ⑥ dựa vào đúng lượt dọn này", () => {
    /*
     * ⚠ Đây là nửa mà mock ở trên phải trung thành: React chạy lượt dọn của CON
     *   trước hiệu ứng của CHA, nên `TwinStudio` KHÔNG thể đọc số thay đổi trong
     *   `useEffect` (nó sẽ thấy 0) — đo được ở khối ⑥. Nếu ai gỡ lượt dọn này
     *   khỏi mã thật thì mock thành lời khai bịa, và ca này phải ĐỎ để báo.
     */
    expect(XUONG).toMatch(/return\s*\(\)\s*=>\s*onThayDoiChuaLuu\?\.\(\{\s*so:\s*0/);
  });

  it("★★★ `luu()` trả KẾT QUẢ để người gọi biết được lưu có thành công không", () => {
    // Nếu `luu()` nuốt lỗi và trả `void`, "Lưu rồi đổi" sẽ đổi tầng cả khi ghi hỏng.
    expect(XUONG).toMatch(/Promise<boolean>/);
  });

  it("★★★ `TwinStudio` truyền `onThayDoiChuaLuu` xuống xưởng", () => {
    expect(STUDIO).toContain("onThayDoiChuaLuu={");
  });

  it("★★★ `key={...tangId}` VẪN CÒN — bản vá không được đổi lấy lỗi ghi nhầm tầng", () => {
    // Gỡ `key` là cách 'dễ' để hết mất buffer, và nó đẻ ra lỗi TỆ HƠN (ghi nhầm
    // tầng). Ghim nguyên văn ở đây để không ai đổi trong một lượt dọn dẹp.
    expect(STUDIO).toMatch(/key=\{tangDangChon\.tangId\}/);
  });
});
