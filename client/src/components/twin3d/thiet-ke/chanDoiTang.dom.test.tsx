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
 * đo bằng mã nguồn trên đĩa ở khối ⑤ — cùng khuôn `quyenXuong.unit.test.ts`.
 *
 * ★ Tệp đặt trong `components/twin3d/thiet-ke/` để nằm trong cổng
 *   `npx vitest run client/src/components/twin3d` (cổng của đợt này).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        chiTietToaNha: { useQuery: tv({ tangs: TANG }) },
        canhThietKe: { useQuery: tv(undefined) },
      },
    },
  };
});

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

beforeEach(() => {
  nhatKyLuu = [];
  kho.tangDangDung = null;
  kho.soLanDung = 0;
  kho.bao = null;
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
/* ⑤ NỬA CÒN LẠI CỦA CHỖ NỐI — đo trên MÃ THẬT trên ĐĨA                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

const GOC = process.cwd();
const XUONG = docMaNguon(resolve(GOC, "client/src/components/twin3d/thiet-ke/XuongThietKe.tsx"));
const STUDIO = docMaNguon(resolve(GOC, "client/src/pages/TwinStudio.tsx"));

describe("★★★ ⑤ chỗ nối THẬT — mock ở trên không được che nửa `XuongThietKe`", () => {
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
