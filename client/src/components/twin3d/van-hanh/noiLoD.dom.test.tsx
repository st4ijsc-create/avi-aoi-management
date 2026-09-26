// @vitest-environment jsdom
//
/**
 * noiLoD.dom.test.tsx — ★★★ ĐỢT 8 LÔ D: **CHỖ NỐI**, đo bằng ca dương.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI TẦNG ĐO, VÀ VÌ SAO CẦN CẢ HAI (G16 + G20)
 * ════════════════════════════════════════════════════════════════════════════
 * Lô B giao `DaiCanhBao.tsx` + `daiCanhBaoLogic.ts` với **35 test logic + 29
 * test DOM**, và vẫn tự khai là CHƯA XONG — vì `TwinVanHanh.tsx` (điểm nối duy
 * nhất) nằm ngoài phạm vi tệp của nó. Đúng: hàm không ai gọi thì chưa giao được
 * gì. Bộ này đo phần lô B không đo được:
 *
 *   TẦNG 1 — **VĂN BẢN chỗ nối**: `TwinVanHanh.tsx` có thật sự dựng `<DaiCanhBao>`
 *            và có thật sự nghe `andon:event` không. Đây là phép đo duy nhất bắt
 *            được chế độ hỏng "gỡ chỗ gọi, mọi cổng vẫn xanh" (đã xảy ra 2 lần).
 *
 *   TẦNG 2 — **HÀNH VI đường ống**, chạy thật: dựng ĐÚNG chuỗi biến đổi mà
 *            `TwinVanHanh.tsx` dựng (`chuanHoaHang` → state `song` → `<DaiCanhBao>`),
 *            bắn TRÙNG THẬT theo đúng khuôn `socket.ts:1389-1395`, rồi ĐẾM DÒNG
 *            TRONG DOM. Không mock `daiCanhBaoLogic` (G20).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G25 — CA DƯƠNG, KHÔNG PHẢI CA RỖNG
 * ════════════════════════════════════════════════════════════════════════════
 * `emitAndonEvent` (`server/_core/socket.ts:1389-1395`) phát **cùng một object**
 * vào `global`, `line:{id}`, `machine:{id}`. Một client nghe cả ba nhận **3 bản
 * giống hệt**. Một dải rỗng cũng "không có dòng lặp" — chứng minh **số 0**. Nên
 * mọi ca ở đây bơm trùng thật rồi đếm, đúng như D4 yêu cầu.
 *
 * ★ Và điểm mấu chốt: dedupe khoá theo `{nguon}:{idNguon}` chứ KHÔNG theo một id
 *   sinh ra ở client. Ca "id đổi mỗi refetch" ghim đúng chỗ đó.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useEffect, useState } from "react";

import { DaiCanhBao } from "./DaiCanhBao";
import {
  chuanHoaHang,
  demKhoaLap,
  gopCanhBao,
  type CanhBaoDai,
  type HangCanhBaoTho,
} from "./daiCanhBaoLogic";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "n" in o ? `${k}:${String(o.n)}` : k),
  }),
}));

afterEach(() => cleanup());

const GOC = resolve(__dirname, "../../../..");
const TRANG = readFileSync(resolve(GOC, "src/pages/TwinVanHanh.tsx"), "utf8");
const NGAN = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/NganXuLy.tsx"), "utf8");

const BAY_GIO = 1_757_000_000_000;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 1 — VĂN BẢN CHỖ NỐI (G16)                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ D4 (#12/#13/#14/#15) — `DaiCanhBao` phải có CHỖ GỌI sản phẩm", () => {
  it("★★★ trang DỰNG `<DaiCanhBao`, không chỉ import tệp", () => {
    // ★ G9 — grep theo TÊN TỆP báo "đã nối" ngay cả khi chỉ có dòng `import`.
    //   Đo bằng THẺ JSX, thứ chỉ tồn tại khi component thực sự được vẽ.
    expect(TRANG).toContain("<DaiCanhBao");
  });

  it("★★★ đủ SÁU prop mà lô B khai — thiếu prop nào là mất tính năng ĐÓ", () => {
    const i = TRANG.indexOf("<DaiCanhBao");
    expect(i).toBeGreaterThan(0);
    const khoi = TRANG.slice(i, i + 800);
    // Thiếu `song` ⇒ mất realtime; thiếu `phamVi` ⇒ mất #15; thiếu
    // `khongDoDuoc` ⇒ 403 hiện thành "0 cảnh báo" (G15, lời nói dối tệ nhất).
    for (const p of ["seed=", "song=", "phamVi=", "bayGio=", "dangTai=", "khongDoDuoc="]) {
      expect(khoi, `thiếu prop ${p}`).toContain(p);
    }
  });

  it("★★★ KHỐI `<ul>` PHẲNG CŨ ĐÃ BIẾN MẤT — nếu không, HAI dải cùng tồn tại", () => {
    // Khối cũ không dedupe, không tách nhóm 24h, không chip lọc mức. Để nó lại
    // cạnh dải mới nghĩa là người vận hành thấy CÙNG một sự cố ở hai chỗ với
    // hai con số khác nhau — tệ hơn cả trước khi nối.
    expect(TRANG).not.toContain("khoi-canh-bao");
    expect(TRANG).not.toMatch(/canh-bao-trai-/);
  });

  it("★★★ trang NGHE `andon:event` — không có nó thì `song` vĩnh viễn rỗng", () => {
    // `song={[]}` là đúng lớp lỗi L-2 của Đợt 7 (`wip={[]}`): prop có mặt, thẻ
    // dựng đủ, cổng xanh, và kênh realtime chở 0 bit.
    expect(TRANG).toContain('socket.on("andon:event"');
    expect(TRANG).toContain('socket.off("andon:event"');
    expect(TRANG).not.toMatch(/song=\{\[\]\}/);
  });

  it("★★★ HAI nguồn đi qua CÙNG `chuanHoaHang` — không có bản chuẩn hoá thứ hai", () => {
    // tRPC superjson trả `Date`, socket trả **chuỗi ISO**. Trừ hai kiểu đó cho
    // `NaN`, và `NaN > NGUONG` là `false` ⇒ mọi cảnh báo rơi vào "Hôm nay" mà
    // không lỗi nào nổ. Một hàm chuẩn hoá dùng chung sinh ra để chặn đúng đó.
    const soLan = (TRANG.match(/chuanHoaHang\(/g) ?? []).length;
    expect(soLan).toBe(2); // một cho seed, một cho socket — không hơn không kém
  });

  it("★★★ `phamViCanhBao` trả `null` ở cấp bao trùm, KHÔNG trả tập rỗng", () => {
    // `null` = "chưa thu hẹp" (hiện tất cả); tập rỗng = "nhánh này thật sự
    // trống" (hiện `[]`). Gộp hai ca sẽ GIẤU SẠCH cảnh báo mỗi khi chưa chọn
    // nhánh — và trông y hệt một nhà máy yên ổn.
    const i = TRANG.indexOf("const phamViCanhBao");
    expect(i).toBeGreaterThan(0);
    const khoi = TRANG.slice(i, i + 900);
    expect(khoi).toContain('phamVi.cap === "tapDoan"');
    expect(khoi).toContain('phamVi.cap === "nhaMay"');
    expect(khoi).toContain("return null");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 2 — HÀNH VI ĐƯỜNG ỐNG, CA DƯƠNG (G25 / G5 / G22)                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Gói `andon:event` như `socket.ts` phát — `raisedAt` là **chuỗi ISO**. */
function goiSocket(id: number, sua: Partial<HangCanhBaoTho> = {}): HangCanhBaoTho {
  return {
    id,
    state: "red",
    status: "raised",
    title: `E-STOP tram ${id}`,
    raisedAt: new Date(BAY_GIO - 3_600_000).toISOString(),
    machineId: 7,
    lineId: 1,
    stationId: null,
    ...sua,
  };
}

/**
 * Bản sao TỐI THIỂU của đường ống trong `TwinVanHanh.tsx`: state `song` được
 * bồi bằng `chuanHoaHang` mỗi lần một gói tới, rồi truyền xuống `<DaiCanhBao>`.
 *
 * ★ Không mock `DaiCanhBao` cũng không mock `daiCanhBaoLogic` — nếu dedupe bị
 *   gỡ ruột, ca này ĐỎ (G20).
 */
function TrangGia({
  goi,
  seed = [],
}: {
  goi: readonly HangCanhBaoTho[];
  seed?: readonly CanhBaoDai[];
}) {
  const [song, setSong] = useState<readonly CanhBaoDai[]>([]);
  useEffect(() => {
    // Mô phỏng handler `socket.on("andon:event", …)` nhận từng gói một.
    for (const g of goi) setSong((truoc) => [chuanHoaHang(g, BAY_GIO), ...truoc].slice(0, 200));
  }, [goi]);
  return <DaiCanhBao seed={seed} song={song} bayGio={BAY_GIO} />;
}

function dong(): HTMLElement[] {
  return screen.queryAllByTestId(/^canh-bao-/);
}

describe("★★★ D4/G25 — BA PHÒNG BẮN TRÙNG THẬT, DOM CHỈ RA MỘT DÒNG", () => {
  it("★★★ CA DƯƠNG: cùng một raise vào 3 phòng ⇒ 3 gói ⇒ **1 dòng**", () => {
    // Đúng khuôn `emitAndonEvent`: cùng một object, ba lần `.emit`.
    const mot = goiSocket(4242);
    render(<TrangGia goi={[mot, mot, mot]} />);
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("canh-bao-andon-4242")).toBeInTheDocument();
  });

  it("★★★ ĐỐI CHỨNG (ca âm) — hai sự cố KHÁC NHAU vẫn ra **2 dòng**", () => {
    // Nếu thiếu ca này, một `gopCanhBao` trả `[dai[0]]` cũng "qua" ca trên.
    render(<TrangGia goi={[goiSocket(1), goiSocket(2)]} />);
    expect(dong()).toHaveLength(2);
  });

  it("★★★ SEED ĐỔI ID MỖI REFETCH — dedupe theo id sẽ khử được **0**", () => {
    // Khoá phải là `{nguon}:{idNguon}` chứ không phải một id sinh ở client.
    // Ở đây hai bản CÙNG `idNguon` 88 nhưng đến từ hai lượt đọc khác nhau.
    const seed = [chuanHoaHang(goiSocket(88), BAY_GIO)];
    render(<TrangGia goi={[goiSocket(88)]} seed={seed} />);
    expect(dong()).toHaveLength(1);
  });

  it("★★★ TRÙNG NẶNG: 3 sự cố × 3 phòng = 9 gói ⇒ **3 dòng**, 0 khoá lặp", () => {
    const goi = [1, 2, 3].flatMap((n) => {
      const g = goiSocket(n);
      return [g, g, g];
    });
    render(<TrangGia goi={goi} />);
    expect(dong()).toHaveLength(3);

    // ★ Dụng cụ ĐỘC LẬP quét đầu ra — nó có quyền bác bỏ `gopCanhBao`.
    const daiCuoi = gopCanhBao(
      [],
      goi.map((g) => chuanHoaHang(g, BAY_GIO)),
    );
    expect(demKhoaLap(daiCuoi)).toBe(0);
    // Và ĐẦU VÀO thì lặp thật — nếu con số này là 0, ca trên đo trên tập rỗng.
    expect(demKhoaLap(goi.map((g) => chuanHoaHang(g, BAY_GIO)))).toBe(3);
  });

  it("★★★ ACK ĐẾN SAU RAISE ⇒ vẫn 1 dòng, và mang PHA MỚI (không phải bản cũ)", () => {
    // `socket.ts` phát cả `raised` lẫn `acknowledged` cho cùng một hàng. Giữ
    // bản cũ nghĩa là người vận hành thấy một alarm "chưa ai xử" đã xử rồi.
    const raise = goiSocket(9);
    const ack = goiSocket(9, {
      status: "acknowledged",
      acknowledgedAt: new Date(BAY_GIO - 60_000).toISOString(),
    });
    render(<TrangGia goi={[raise, ack]} />);
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("canh-bao-andon-9")).toHaveAttribute("data-pha", "acknowledged");
  });

  it("★★★ CHUỖI ISO (socket) và Date (tRPC) cho CÙNG mốc — không `NaN` câm", () => {
    const iso = chuanHoaHang(goiSocket(5), BAY_GIO);
    const dat = chuanHoaHang(goiSocket(5, { raisedAt: new Date(BAY_GIO - 3_600_000) }), BAY_GIO);
    expect(iso.luc).toBe(dat.luc);
    expect(Number.isNaN(iso.luc)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* D3 (#60) — STATS AOI PHẢI CÓ CHỖ GỌI TRONG `NganXuLy.tsx`                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ D3 (#60) — Stats AOI OK/NG/NTF/Yield có CHỖ GỌI thật", () => {
  it("★★★ `NganXuLy` gọi truy vấn thống kê THẬT, không hằng trong mã", () => {
    expect(NGAN).toContain("trpc.dashboard.getMachineStats.useQuery");
    expect(NGAN).toContain("docStatsAoi(");
  });

  it("★★★ BỐN ô đều được VẼ — neo vào MẢNG SINH RA CHÚNG, không grep chuỗi phẳng", () => {
    /*
     * ★★★ BÀI HỌC G9 CỦA CHÍNH CA NÀY, ghi lại vì nó suýt thành xanh giả:
     *   bản đầu viết `expect(NGAN).toContain("stats-ok")` và nó ĐỎ — KHÔNG phải
     *   vì tính năng thiếu, mà vì ba ô OK/NG/NTF sinh trong một `.map()` với
     *   ``data-testid={`stats-${ma_}`}``. Chuỗi "stats-ok" không tồn tại trong
     *   tệp nguồn; nó chỉ tồn tại lúc chạy.
     *
     * ⇒ Cám dỗ là hạ kỳ vọng xuống `toContain("stats-")` cho xanh — nhưng một
     *   `data-testid` prefix cũng thoả, tức là đo đúng SỐ 0. Thay vào đó ta neo
     *   vào ĐÚNG cái sinh ra bốn ô: ba mã trong mảng, cộng ô Yield viết tay.
     */
    const i = NGAN.indexOf('data-testid={`stats-${ma_}`}');
    expect(i, "ba ô OK/NG/NTF không còn sinh từ một mảng").toBeGreaterThan(0);
    // Ba mã nằm trong mảng khai ngay trên `.map`.
    const mang = NGAN.slice(NGAN.indexOf('["ok", "twin3d.vanHanh.aoiOk"'), i);
    for (const ma_ of ['"ok"', '"ng"', '"ntf"']) {
      expect(mang, `thiếu mã ${ma_} trong mảng ô`).toContain(ma_);
    }
    // Ô thứ tư viết tay (đơn vị `%`, khác ba ô đếm) ⇒ testid phẳng, grep được.
    expect(NGAN).toContain('data-testid="stats-yield"');
  });

  it("★★★ SPEC/BRIEF SAI ĐÃ ĐƯỢC BÁC: KHÔNG GỌI `getAllMachinesStats`", () => {
    /*
     * Thủ tục đó chạy `Promise.all` một `getMachineStats` cho MỖI máy (42 trên
     * SIM-FAC) để ngăn này dùng đúng MỘT hàng — N+1 mà Đ6 sinh ra để diệt.
     *
     * ⚠ Đo CHỖ GỌI, không đo sự XUẤT HIỆN của chuỗi: tên đó CÓ nằm trong tệp,
     *   ở docblock giải thích vì sao không dùng nó. Một `not.toContain` trần sẽ
     *   biến "ghi lại lý do" thành lỗi cổng — và cách sửa dễ nhất là XOÁ lời
     *   giải thích, tức là tự tay xoá thứ có giá trị nhất.
     */
    expect(NGAN).not.toMatch(/trpc\.dashboard\.getAllMachinesStats/);
    expect(NGAN).toContain("trpc.dashboard.getMachineStats.useQuery");
  });

  it("★★★ G15 — truy vấn gắn `isSuccess`, KHÔNG chỉ `data`", () => {
    // `data` rỗng vì 403 trông y hệt `data` rỗng vì máy chưa kiểm chiếc nào.
    const i = NGAN.indexOf("docStatsAoi(");
    expect(i).toBeGreaterThan(0);
    expect(NGAN.slice(i, i + 120)).toContain("statsQ.isSuccess");
  });

  it("★★★ ô Yield hiện `—` (không phải `0%`) khi chưa đo được", () => {
    expect(NGAN).toContain("statsAoi.yieldRate === null ? hienSo(null)");
  });
});
