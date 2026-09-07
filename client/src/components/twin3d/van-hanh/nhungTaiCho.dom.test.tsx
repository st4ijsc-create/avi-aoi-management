// @vitest-environment jsdom
//
/**
 * nhungTaiCho.dom.test.tsx — ★★★ ĐỢT 10 LÔ G: **XEM CHI TIẾT TẠI CHỖ**, đo hành vi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI TẦNG ĐO, VÀ VÌ SAO CẦN CẢ HAI (G16 + G20)
 * ════════════════════════════════════════════════════════════════════════════
 *   TẦNG 1 — **VĂN BẢN chỗ nối**: `TwinVanHanh.tsx` có thật sự truyền
 *            `onMoTaiCho`/`nganNhung`/`onDongNhung` xuống `NganXuLy` không, và
 *            `NganXuLy.tsx` có thật sự dựng `<NganNhung>` không. Đây là phép đo
 *            DUY NHẤT bắt được chế độ hỏng "gỡ chỗ gọi, mọi cổng vẫn xanh" —
 *            đúng lớp lỗi đã xảy ra 2 lần trong dự án này (§11d.4).
 *            Panel dựng xong mà không ai mở được = CHƯA XONG.
 *
 *   TẦNG 2 — **HÀNH VI, chạy thật**: render `NganXuLy` thật, bấm nút thật, và
 *            hỏi hàm nào được gọi với đối số nào. Không mock `nhungTaiCho`
 *            (G20 — module giao hàng phải nằm trong đường đo).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5/G32 — DỮ LIỆU KHÁC RỖNG, VÀ ĐẦU RA PHẢI KHÁC ĐẦU VÀO
 * ════════════════════════════════════════════════════════════════════════════
 * Một `NganXuLy` render 0 nút cũng "không gọi `onDieuHuong`" — chứng minh SỐ 0.
 * Nên mọi ca dưới đây dựng máy THẬT (`machineId=42`), quyền THẬT (đủ để nút
 * hiện), và **đếm số nút thực sự có mặt** trước khi kết luận gì về hành vi bấm.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MOCK `@/pages/*` — VÀ VÌ SAO ĐIỀU ĐÓ KHÔNG PHẢI G20
 * ════════════════════════════════════════════════════════════════════════════
 * `NganNhung` nạp LƯỜI ba thân cockpit (~5k LOC + recharts + socket + trpc).
 * Kéo chúng vào jsdom là đo môi trường, không đo tính năng. Ta mock đúng ba
 * module TRANG đó bằng thẻ nhận dạng, và **KHÔNG mock** `nhungTaiCho`,
 * `NganNhung`, `NganXuLy`, `nganXuLyLogic` — tức là mọi luật của lô G vẫn nằm
 * trong đường đo. Phép thử "xoá sạch mã sản phẩm, test có đỏ không" vẫn CÓ.
 *
 * ★ Và cái được ghim ở đây chính là thứ mock KHÔNG che được: **thân nào được
 *   chọn cho loại nào**. Mock trả về `data-testid` khác nhau nên một `robot`
 *   render nhầm thân máy sẽ đỏ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NganNhung } from "./NganNhung";
import { NganXuLy, type NganXuLyProps } from "./NganXuLy";
import { nhungChoHref, type NganNhungMo } from "./nhungTaiCho";
import type { QuyenXuLy } from "./nganXuLyLogic";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bệ đỡ                                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: unknown) => (typeof f === "string" ? f : k),
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/*
 * ★ Bốn điểm trpc của `NganXuLy` — ĐỌC TỪ NGUỒN, không đoán tên (G24). Lượt
 *   viết đầu của tệp này đoán `user.list`; tên thật là `user.assignableTechnicians`,
 *   và hậu quả là `undefined.useQuery` — 11 ca đỏ cùng lúc vì cùng một chỗ sai.
 */
vi.mock("@/lib/trpc", () => {
  const mut = () => ({ mutate: vi.fn(), isPending: false });
  const truyVan = (data: unknown) => () => ({
    data,
    isLoading: false,
    isError: false,
    error: null,
  });
  return {
    trpc: {
      andon: { acknowledge: { useMutation: mut } },
      maintenance: { createWorkOrder: { useMutation: mut } },
      equipmentStandards: { shelveMasterAlarm: { useMutation: mut } },
      user: { assignableTechnicians: { useQuery: truyVan([]) } },
      dashboard: { getMachineStats: { useQuery: truyVan(null) } },
    },
  };
});

vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn() }));

/* ★ Ba thân cockpit — mock để không kéo ~5k LOC vào jsdom. Mỗi thân có thẻ
   RIÊNG nên "chọn nhầm thân" là một ca đỏ được, không phải một ca im lặng. */
vi.mock("@/pages/MachineCockpit", () => ({
  MachineCockpitBody: ({ machineId }: { machineId: number }) => (
    <div data-testid="than-may-gia" data-machine-id={machineId} />
  ),
}));
vi.mock("@/pages/RobotCockpit", () => ({
  RobotCockpitBody: ({ robotId }: { robotId: number }) => (
    <div data-testid="than-robot-gia" data-robot-id={robotId} />
  ),
}));
vi.mock("@/pages/StationAnalysis", () => ({
  StationAnalysisBody: ({ stationId }: { stationId: number }) => (
    <div data-testid="than-tram-gia" data-station-id={stationId} />
  ),
}));

afterEach(() => cleanup());

const GOC = resolve(__dirname, "../../../..");
const TRANG = readFileSync(resolve(GOC, "src/pages/TwinVanHanh.tsx"), "utf8");
const NGAN_XU_LY = readFileSync(
  resolve(GOC, "src/components/twin3d/van-hanh/NganXuLy.tsx"),
  "utf8",
);

/** Quyền ĐỦ để mọi nút hiện — ca rỗng quyền chứng minh số 0, không dùng ở đây. */
const QUYEN_DU: QuyenXuLy = {
  ackAlarm: true,
  anTamAlarm: true,
  taoPhieu: true,
  suaPhieu: true,
};

function dungProps(ghiDe: Partial<NganXuLyProps> = {}): NganXuLyProps {
  return {
    machineId: 42,
    ma: "M-042",
    ten: "Máy dán keo",
    trangThai: { trangThai: "chay", tuoi: "tuoi", daGhiDe: false },
    thoiDiemDuLieu: Date.now(),
    bayGio: Date.now(),
    canhBao: [],
    quyen: QUYEN_DU,
    coQuyenXem: () => true, // mọi nút điều hướng hiện — G5: tập KHÁC RỖNG
    onDaXuLy: vi.fn(),
    onDieuHuong: vi.fn(),
    ...ghiDe,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 1 — CHỖ NỐI (G16). Panel không ai mở được = CHƯA XONG.                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("TẦNG 1 — chỗ nối văn bản (G16)", () => {
  it("★★★ TwinVanHanh.tsx TRUYỀN cả ba móc xuống NganXuLy", () => {
    // Gỡ bất kỳ dòng nào trong ba dòng này ⇒ tính năng chết câm, mọi cổng vẫn xanh.
    expect(TRANG).toContain("onMoTaiCho={moTaiCho}");
    expect(TRANG).toContain("nganNhung={nganNhung}");
    expect(TRANG).toContain("onDongNhung={dongNhung}");
  });

  it("★★★ TwinVanHanh.tsx ĐỌC ngăn từ URL và GHI ngăn vào URL", () => {
    // Trạng thái ngăn phải ở URL, không ở useState — nếu không, F5 mất ngăn.
    expect(TRANG).toContain("docXemTuQuery(search)");
    expect(TRANG).toContain("tronXemVaoQuery(window.location.search, ngan)");
  });

  it("★ ghi ngăn dùng setLocation (push) ⇒ nút Back của trình duyệt ĐÓNG ngăn", () => {
    // "có phím back cũng được" của chủ sở hữu — miễn phí nhờ trạng thái ở URL.
    const khoi = TRANG.slice(TRANG.indexOf("const ghiXem"), TRANG.indexOf("const moTaiCho"));
    expect(khoi).toContain("setLocation(");
    expect(khoi).not.toContain("replaceState");
  });

  it("★★★ NganXuLy.tsx DỰNG <NganNhung> — ngăn có chỗ vẽ thật", () => {
    expect(NGAN_XU_LY).toContain("<NganNhung");
    expect(NGAN_XU_LY).toContain('from "./NganNhung"');
  });

  it("★★★ nút điều hướng ĐI QUA nhungChoHref, không qua một cờ thứ hai (G12)", () => {
    // Nếu ai đó thêm ô `nhung` vào bảng `nutDieuHuongCho`, sẽ có HAI nguồn sự
    // thật về "nút này mở tại chỗ hay không", và chúng sẽ lệch.
    expect(NGAN_XU_LY).toContain("nhungChoHref(n.href)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 2 — HÀNH VI: bấm thật, hỏi ai được gọi                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("TẦNG 2 — bấm nút 'Mở chức năng'", () => {
  it("★ tiền đề G5: tập nút KHÁC RỖNG, và có CẢ HAI loại đích", () => {
    render(<NganXuLy {...dungProps({ onMoTaiCho: vi.fn() })} />);
    const nhom = screen.getByTestId("nhom-mo-chuc-nang");
    const nut = within(nhom).getAllByRole("button");
    // Máy có 5 đích (§9.3): /machine/:id, /device-monitor, /history,
    // /traceability, /control-plane.
    expect(nut.length).toBeGreaterThan(1);
    const taiCho = nut.filter((b) => b.getAttribute("data-tai-cho") === "1");
    const roiTrang = nut.filter((b) => b.getAttribute("data-tai-cho") === "0");
    // ★★★ Nếu TẤT CẢ cùng một loại, phép đo dưới không phân biệt được gì.
    expect(taiCho.length).toBeGreaterThan(0);
    expect(roiTrang.length).toBeGreaterThan(0);
  });

  it("★★★ đích NHÚNG ĐƯỢC gọi onMoTaiCho, KHÔNG gọi onDieuHuong", async () => {
    const onMoTaiCho = vi.fn();
    const onDieuHuong = vi.fn();
    render(<NganXuLy {...dungProps({ onMoTaiCho, onDieuHuong })} />);

    await userEvent.click(screen.getByTestId("nut-dieu-huong-cockpit"));

    // Đầu ra KHÁC đầu vào, và ĐÚNG ngăn (G32):
    expect(onMoTaiCho).toHaveBeenCalledWith({ loai: "machine", id: 42 });
    // ★★★ Đây là chính nỗi bất tiện chủ sở hữu than phiền — nó phải BẰNG 0:
    expect(onDieuHuong).not.toHaveBeenCalled();
  });

  it("★★★ đích CHƯA nhúng được vẫn đi đường cũ — không có nút chết", async () => {
    const onMoTaiCho = vi.fn();
    const onDieuHuong = vi.fn();
    render(<NganXuLy {...dungProps({ onMoTaiCho, onDieuHuong })} />);

    // `/control-plane` = màn ra lệnh OT, cố ý KHÔNG nhúng.
    await userEvent.click(screen.getByTestId("nut-dieu-huong-dieuKhien"));

    expect(onDieuHuong).toHaveBeenCalledWith("/control-plane?machineId=42");
    expect(onMoTaiCho).not.toHaveBeenCalled();
  });

  it("★★★ onMoTaiCho VẮNG ⇒ rơi về onDieuHuong, KHÔNG phải nút chết", async () => {
    // Tầng trên chưa nối (hoặc một consumer khác của NganXuLy) — nút phải vẫn
    // làm được việc cũ. Một nút không làm gì là chế độ hỏng câm.
    const onDieuHuong = vi.fn();
    render(<NganXuLy {...dungProps({ onMoTaiCho: undefined, onDieuHuong })} />);

    await userEvent.click(screen.getByTestId("nut-dieu-huong-cockpit"));

    expect(onDieuHuong).toHaveBeenCalledWith("/machine/42");
  });

  it("★★★ ICON phải khác nhau — hai hành vi phải NHÌN RA ĐƯỢC", () => {
    // `ExternalLink` là lời hứa "bấm là rời trang". Để nguyên nó trên nút mở
    // tại chỗ là nói dối theo chiều ngược lại, và người dùng sẽ không dám bấm.
    render(<NganXuLy {...dungProps({ onMoTaiCho: vi.fn() })} />);
    const taiCho = screen.getByTestId("nut-dieu-huong-cockpit");
    const roiTrang = screen.getByTestId("nut-dieu-huong-dieuKhien");
    expect(taiCho.querySelector("svg")?.getAttribute("class")).not.toBe(
      roiTrang.querySelector("svg")?.getAttribute("class"),
    );
    expect(taiCho).toHaveAttribute("data-tai-cho", "1");
    expect(roiTrang).toHaveAttribute("data-tai-cho", "0");
  });

  it("robot: bấm mở ngăn robot đúng id (bộ nút §9.3 khác hẳn bộ của máy)", async () => {
    const onMoTaiCho = vi.fn();
    render(
      <NganXuLy {...dungProps({ machineId: 7, loaiDich: "robot", onMoTaiCho })} />,
    );
    await userEvent.click(screen.getByTestId("nut-dieu-huong-robotCockpit"));
    expect(onMoTaiCho).toHaveBeenCalledWith({ loai: "robot", id: 7 });
  });

  it("trạm: bấm mở ngăn trạm đúng id", async () => {
    const onMoTaiCho = vi.fn();
    render(
      <NganXuLy {...dungProps({ machineId: 5, loaiDich: "station", onMoTaiCho })} />,
    );
    await userEvent.click(screen.getByTestId("nut-dieu-huong-phanTichTram"));
    expect(onMoTaiCho).toHaveBeenCalledWith({ loai: "station", id: 5 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NGĂN NHÚNG — nội dung, nút quay lại, và "KHÔNG RỜI /twin"                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("NganNhung — ngăn chi tiết tại chỗ", () => {
  it("★ ngăn ĐÓNG (null) ⇒ 0 nút DOM (ca đối chứng cho mọi ca dưới)", () => {
    render(<NganNhung ngan={null} onDong={vi.fn()} />);
    expect(screen.queryByTestId("ngan-nhung")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nut-quay-lai-nhung")).not.toBeInTheDocument();
  });

  it("★★★ mở ngăn MÁY ⇒ render THÂN MÁY, đúng id — không phải thân khác", async () => {
    render(<NganNhung ngan={{ loai: "machine", id: 42 }} onDong={vi.fn()} />);
    const than = await screen.findByTestId("than-may-gia");
    expect(than).toHaveAttribute("data-machine-id", "42");
    // ...và KHÔNG render hai thân kia (chọn nhầm thân là ca đỏ được):
    expect(screen.queryByTestId("than-robot-gia")).not.toBeInTheDocument();
    expect(screen.queryByTestId("than-tram-gia")).not.toBeInTheDocument();
  });

  it("★★★ mở ngăn ROBOT ⇒ render THÂN ROBOT, đúng id", async () => {
    render(<NganNhung ngan={{ loai: "robot", id: 7 }} onDong={vi.fn()} />);
    expect(await screen.findByTestId("than-robot-gia")).toHaveAttribute("data-robot-id", "7");
    expect(screen.queryByTestId("than-may-gia")).not.toBeInTheDocument();
  });

  it("★★★ mở ngăn TRẠM ⇒ render THÂN TRẠM, đúng id", async () => {
    render(<NganNhung ngan={{ loai: "station", id: 5 }} onDong={vi.fn()} />);
    expect(await screen.findByTestId("than-tram-gia")).toHaveAttribute("data-station-id", "5");
    expect(screen.queryByTestId("than-robot-gia")).not.toBeInTheDocument();
  });

  it("★★★ NÚT QUAY LẠI có thật và gọi onDong — 'phím back' của yêu cầu", async () => {
    const onDong = vi.fn();
    render(<NganNhung ngan={{ loai: "machine", id: 42 }} onDong={onDong} />);
    await userEvent.click(screen.getByTestId("nut-quay-lai-nhung"));
    expect(onDong).toHaveBeenCalledTimes(1);
  });

  it("★★★ Esc ĐÓNG ngăn — thiếu nó là bẫy bàn phím (§9.9)", async () => {
    const onDong = vi.fn();
    render(<NganNhung ngan={{ loai: "machine", id: 42 }} onDong={onDong} />);
    await userEvent.keyboard("{Escape}");
    expect(onDong).toHaveBeenCalled();
  });

  it("★★★ LỐI THOÁT PHỤ trỏ đúng href gốc, mở TAB MỚI, có rel an toàn", () => {
    const ngan: NganNhungMo = { loai: "station", id: 5 };
    render(<NganNhung ngan={ngan} onDong={vi.fn()} />);
    // ★ `<Button asChild>` hợp nhất props vào chính `<a>`, nên thẻ test nằm
    //   TRÊN thẻ neo — không có phần tử bọc nào để `within()` đi vào.
    const the = screen.getByTestId("nut-mo-man-day-du") as HTMLAnchorElement;
    expect(the.tagName).toBe("A");
    expect(the).toHaveAttribute("href", "/station-analysis/5");
    expect(the).toHaveAttribute("target", "_blank");
    // Thiếu `noreferrer` ⇒ trang mới giữ `window.opener` và điều hướng được Twin.
    expect(the.getAttribute("rel")).toContain("noreferrer");
    // ★ Và href đó phải KHỚP nội dung đang hiện (nghịch đảo thật):
    expect(nhungChoHref(the.getAttribute("href")!)).toEqual(ngan);
  });

  it("★ ngăn là hộp thoại có TÊN cho trình đọc màn hình", () => {
    render(<NganNhung ngan={{ loai: "robot", id: 7 }} onDong={vi.fn()} />);
    const hop = screen.getByTestId("ngan-nhung");
    expect(hop).toHaveAttribute("data-loai", "robot");
    expect(hop).toHaveAttribute("data-id", "7");
    expect(screen.getByTestId("tieu-de-nhung")).toHaveTextContent(/.+/);
  });

  it("★ nhãn phụ hiện MÃ máy — người dùng biết đang xem CÁI GÌ", () => {
    render(
      <NganNhung ngan={{ loai: "machine", id: 42 }} nhanPhu="M-042 · Máy dán keo" onDong={vi.fn()} />,
    );
    expect(screen.getByTestId("ngan-nhung")).toHaveTextContent("M-042");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NỐI TRỌN VÒNG — bấm nút trong NganXuLy ⇒ ngăn MỞ với đúng nội dung          */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ trọn vòng: bấm → ngăn mở → quay lại", () => {
  it("NganXuLy nhận `nganNhung` ⇒ ngăn hiện NGAY trong cây của nó", async () => {
    render(
      <NganXuLy
        {...dungProps({
          onMoTaiCho: vi.fn(),
          nganNhung: { loai: "machine", id: 42 },
          onDongNhung: vi.fn(),
        })}
      />,
    );
    // Ngăn xử lý VẪN CÒN (người dùng không rời màn) + ngăn chi tiết ĐÃ MỞ:
    expect(screen.getByTestId("ngan-xu-ly")).toBeInTheDocument();
    expect(screen.getByTestId("ngan-nhung")).toBeInTheDocument();
    expect(await screen.findByTestId("than-may-gia")).toHaveAttribute("data-machine-id", "42");
  });

  it("nút quay lại trong ngăn gọi ĐÚNG `onDongNhung` của tầng trên", async () => {
    const onDongNhung = vi.fn();
    render(
      <NganXuLy
        {...dungProps({
          onMoTaiCho: vi.fn(),
          nganNhung: { loai: "machine", id: 42 },
          onDongNhung,
        })}
      />,
    );
    await userEvent.click(screen.getByTestId("nut-quay-lai-nhung"));
    expect(onDongNhung).toHaveBeenCalledTimes(1);
  });

  it("★ `nganNhung` vắng ⇒ NganXuLy render bình thường, 0 ngăn (không vỡ)", () => {
    render(<NganXuLy {...dungProps()} />);
    expect(screen.getByTestId("ngan-xu-ly")).toBeInTheDocument();
    expect(screen.queryByTestId("ngan-nhung")).not.toBeInTheDocument();
  });
});
