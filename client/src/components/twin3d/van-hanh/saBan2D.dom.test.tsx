// @vitest-environment jsdom
/**
 * saBan2D.dom.test.tsx — ★★★ PH-44 Ở **BẢN 2D**: cùng đơn vị vẽ với bản 3D.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SỐ ĐO SINH RA TỆP NÀY (trình duyệt thật, cổng 3064, 1280×720, khung MẶC
 *     ĐỊNH, vai `qatd_giamdoc`, `?pv=tapdoan`)
 * ════════════════════════════════════════════════════════════════════════════
 * Task 20 đổi đơn vị vẽ ở cấp tập đoàn cho **bản 3D** (1.108 khối máy → 12 biểu
 * tượng toà). Bản 2D KHÔNG đổi, và đo được trên `dist-ph45`:
 *
 *   bản 3D  · 12 biểu tượng · rộng 56,5 .. 83,0 px · 15 nhãn · mực ảnh 24,8 %
 *   bản 2D  · 1.108 khối máy · rộng **0,11 .. 3,95 px** (trung vị **1,32 px**)
 *             · 234 máy dưới 1 px · **1.108/1.108 dưới 4 px** · **0 nhãn**
 *             · mực ảnh 9,7 % — ảnh `anh/b1-truoc/qatd_giamdoc-2d-2-svg.png`
 *             gần như ĐEN, đúng thứ Task 20 vá cho bản 3D.
 *
 * ⇒ Đây KHÔNG phải "hai chế độ vẽ hai thứ khác nhau cho có lý do". Đây là **cùng
 *   một khuyết tật PH-44** (tỉ lệ nuốt vật thể) còn nguyên ở chế độ kia.
 *
 * ★★★ ĐỐI CHỨNG ĐÃ CHẠY — 2D KHÔNG PHẢI DO TASK 20 LÀM HỎNG.
 *   Đo lại trên `dist-t19` (bản TRƯỚC Task 20, cùng dữ liệu, cùng khung):
 *     viewBox `2244 × 184` · 1.108 máy · rộng 0,05 .. 1,94 px (trung vị **0,65
 *     px**) · **924/1.108 dưới 1 px** · ảnh cũng đen.
 *   Tức 2D vốn đã hỏng ở cấp này; Task 20 vô tình làm nó TO GẤP ĐÔI (0,65 →
 *   1,32 px) vì sa bàn nén khuôn viên 2.240 m → 673 m, nhưng 1,32 px vẫn là số
 *   không đọc được. Bản vá này không phải "hoàn nguyên Task 20" mà là mang đúng
 *   cách chữa của nó sang chế độ còn lại.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG CHỌN "GIỮ MÁY + THÊM LỜI KHAI"
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinVanHanh.tsx` đặt `che2D = epChe2D || webglHong`, và nút chuyển bị
 * `disabled={webglHong}`. Nghĩa là bản 2D **là đường dự phòng khi WebGL hỏng**:
 * lúc ấy người dùng KHÔNG rời khỏi nó được. Một lời khai *"1.108 vật thể bạn
 * không nhìn thấy"* là trung thực nhưng để người dùng WebGL-hỏng ở lại với một
 * ô đen — nên hướng đã chọn là **cùng đơn vị vẽ cho cả hai chế độ**.
 *
 * ★ Và nó đóng luôn một lời khai sai ĐANG SỐNG: đo được ở chế độ 2D,
 *   `banner-vi-tri-tam-sinh` vẫn nói *"each building is an icon, and 12
 *   buildings … are grouped into clusters"* trong khi màn vẽ 1.108 máy và 0 biểu
 *   tượng. Cho 2D vẽ đúng biểu tượng làm câu ấy THÀNH THẬT ở cả hai chế độ, thay
 *   vì phải viết thêm câu thứ năm để chống chế cho câu thứ tư.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ĐO GÌ Ở ĐÂY, ĐO GÌ Ở NGOÀI
 * ════════════════════════════════════════════════════════════════════════════
 * jsdom KHÔNG có bộ dựng bố cục: `getBoundingClientRect()` của `<rect>` luôn 0,
 * nên **kích thước pixel** là việc của `.qa-tapdoan/b1-do-2d.mjs` trên trình
 * duyệt thật. Tệp này ghim thứ jsdom đo ĐƯỢC và ghim chắc: đơn vị vẽ nào được
 * chọn, THAY hay ĐỨNG CẠNH, hình học trong hệ toạ độ mô hình, và nhãn.
 *
 * ★ G20 — dựng CHÍNH `CanhVanHanh2D` mà `TwinVanHanh.tsx:4165` render.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { CanhVanHanh2D } from "./CanhVanHanh2D";
import {
  MAU_BIEU_TUONG_TOA,
  NEN_CUM_SANG,
  type BieuTuongToaVe,
  type CumSaBanVe,
} from "./hopNhatCanh";
import type { MayTrongLo } from "../loi";

afterEach(() => cleanup());

/** Ba máy thật-hình-dạng (mm) — dùng cho ĐỐI CHỨNG ÂM "một nhà máy". */
function dungMay(n: number): MayTrongLo[] {
  return Array.from({ length: n }, (_, i) => ({
    machineId: i + 1,
    khoi: "hop" as MayTrongLo["khoi"],
    kichThuocMm: { rongMm: 2_000, sauMm: 1_500, caoMm: 2_200 },
    viTri: { x: 3 + i * 4, y: 0, z: 5 },
    gocXoayRad: 0,
    mau: "#22c55e",
  }));
}

/**
 * Sa bàn 12 toà / 3 cụm — CÙNG HÌNH DẠNG bộ sinh QATD cho ra (3 công ty × 4
 * toà). Toạ độ là mét trong hệ scene, đúng thứ `dungSaBanVe()` trả.
 */
function dungSaBan(): { toa: BieuTuongToaVe[]; cum: CumSaBanVe[] } {
  const toa: BieuTuongToaVe[] = [];
  const cum: CumSaBanVe[] = [];
  const TEN_NM = ["Công ty A", "Công ty B", "Công ty C"];
  for (let c = 0; c < 3; c += 1) {
    const cx = 60 + (c % 2) * 300;
    const cz = 60 + Math.floor(c / 2) * 300;
    cum.push({
      factoryId: 48 + c,
      chiSoCum: c,
      nhan: TEN_NM[c],
      viTri: { x: cx + 100, y: 0, z: cz + 100 },
      co: { rong: 200, sau: 200 },
    });
    for (let b = 0; b < 4; b += 1) {
      toa.push({
        toaNhaId: 100 + c * 4 + b,
        factoryId: 48 + c,
        chiSoCum: c,
        nhan: `Toà ${b + 1}`,
        viTri: { x: cx + 50 + (b % 2) * 100, y: 15, z: cz + 50 + Math.floor(b / 2) * 100 },
        co: { rong: 60, cao: 30, sau: 60 },
      });
    }
  }
  return { toa, cum };
}

const RONG_M = 677;
const SAU_M = 557;

function ve(opt: { soMay: number; saBan?: boolean }) {
  const may = dungMay(opt.soMay);
  const sb = opt.saBan ? dungSaBan() : { toa: [], cum: [] };
  const r = render(
    <CanhVanHanh2D
      may={may}
      trangThaiTheoMay={new Map(may.map((m) => [m.machineId, "running"]))}
      maTheoMay={new Map(may.map((m) => [m.machineId, `QATD-A-M${m.machineId}`]))}
      machineIdChon={null}
      onChonMay={() => {}}
      sanRongM={RONG_M}
      sanSauM={SAU_M}
      saBan={sb.toa}
      saBanCum={sb.cum}
      nhanTrangThai={(tt) => tt}
      ariaLabel="cảnh 2D"
    />,
  );
  const svg = r.container.querySelector("svg") as SVGSVGElement;
  const q = (id: string) => [...svg.querySelectorAll(`[data-testid='${id}']`)];
  return { r, svg, q, may, sb };
}

describe("★ dữ kiện nền — phép đo biết KÊU trước khi nó biết GẬT", () => {
  it("bộ dựng sa bàn của tệp này thật sự có 12 toà / 3 cụm / 3 tên công ty", () => {
    const sb = dungSaBan();
    expect(sb.toa).toHaveLength(12);
    expect(sb.cum).toHaveLength(3);
    expect(new Set(sb.cum.map((c) => c.nhan)).size).toBe(3);
    expect(new Set(sb.toa.map((v) => v.factoryId)).size).toBe(3);
  });

  it("★★★ ĐỐI CHỨNG ÂM — sa bàn RỖNG ⇒ vẫn vẽ MÁY, y như `/twin` một nhà máy", () => {
    // Đây là ô giữ tiêu chí 4 của chủ đợt: `/twin` một nhà máy không đổi một ô
    // nào. Nếu ô này đỏ thì bản vá đã ăn vào đường đang dùng được.
    const { q } = ve({ soMay: 3, saBan: false });
    expect(q("may-2d-1")).toHaveLength(1);
    expect(q("may-2d-2")).toHaveLength(1);
    expect(q("may-2d-3")).toHaveLength(1);
    expect(q("toa-2d-sa-ban")).toHaveLength(0);
    expect(q("cum-2d-sa-ban")).toHaveLength(0);
  });
});

describe("★★★ H1 — SA BÀN **THAY** LỚP MÁY Ở BẢN 2D (cùng luật với bản 3D)", () => {
  it("sa bàn không rỗng ⇒ 12 biểu tượng toà, 3 nền cụm, và **0** khối máy", () => {
    const { q } = ve({ soMay: 1108, saBan: true });
    expect(q("toa-2d-sa-ban")).toHaveLength(12);
    expect(q("cum-2d-sa-ban")).toHaveLength(3);
    // ★ Vẽ cả hai là tự mâu thuẫn — `LopSaBan.tsx` đã ghi đúng lý lẽ ấy cho 3D.
    expect(q("may-2d-1")).toHaveLength(0);
    expect([...document.querySelectorAll("[data-testid^='may-2d-']")]).toHaveLength(0);
  });

  it("★★★ MÀN NÓI RA ĐƠN VỊ VẼ, không để người đọc tự suy từ số hình", () => {
    const a = ve({ soMay: 1108, saBan: true });
    expect(a.svg.getAttribute("data-don-vi-ve")).toBe("toa-nha");
    a.r.unmount();
    const b = ve({ soMay: 3, saBan: false });
    expect(b.svg.getAttribute("data-don-vi-ve")).toBe("may");
  });

  it("★ lớp sa bàn 2D tự khai số toà/số cụm để phép đo ngoài trang đọc được", () => {
    const { q } = ve({ soMay: 1108, saBan: true });
    const lop = q("lop-sa-ban-2d")[0];
    expect(lop).toBeTruthy();
    expect(lop.getAttribute("data-so-toa")).toBe("12");
    expect(lop.getAttribute("data-so-cum")).toBe("3");
  });
});

describe("★★★ H2 — HÌNH HỌC: biểu tượng vẽ ĐÚNG chỗ và ĐÚNG cỡ của mô hình", () => {
  it("mỗi `<rect>` toà khít hộp `viTri ± co/2` trong hệ toạ độ mô hình", () => {
    const { q, sb } = ve({ soMay: 0, saBan: true });
    const rects = q("toa-2d-sa-ban") as SVGRectElement[];
    expect(rects).toHaveLength(12);
    for (const v of sb.toa) {
      const el = rects.find((e) => e.getAttribute("data-toa-nha-id") === String(v.toaNhaId));
      expect(el, `thiếu toà ${v.toaNhaId}`).toBeTruthy();
      expect(Number(el!.getAttribute("width"))).toBeCloseTo(v.co.rong, 6);
      expect(Number(el!.getAttribute("height"))).toBeCloseTo(v.co.sau, 6);
      expect(Number(el!.getAttribute("x"))).toBeCloseTo(v.viTri.x - v.co.rong / 2, 6);
      // ★ Bản 2D nhìn TỪ TRÊN XUỐNG: trục dọc của màn là `z` của scene (đúng
      //   phép chiếu mà lớp máy đã dùng: `translate(viTri.x viTri.z)`).
      expect(Number(el!.getAttribute("y"))).toBeCloseTo(v.viTri.z - v.co.sau / 2, 6);
    }
  });

  it("nền cụm khít `viTri ± co/2` và mang `data-factory-id` để gom theo NHÀ MÁY", () => {
    const { q, sb } = ve({ soMay: 0, saBan: true });
    const rects = q("cum-2d-sa-ban") as SVGRectElement[];
    for (const c of sb.cum) {
      const el = rects.find((e) => e.getAttribute("data-factory-id") === String(c.factoryId));
      expect(el, `thiếu cụm ${c.factoryId}`).toBeTruthy();
      expect(Number(el!.getAttribute("width"))).toBeCloseTo(c.co.rong, 6);
      expect(Number(el!.getAttribute("height"))).toBeCloseTo(c.co.sau, 6);
    }
  });

  it("★★★ nền cụm vẽ TRƯỚC biểu tượng toà — ngược lại là tấm nền đè mất toà", () => {
    const { svg } = ve({ soMay: 0, saBan: true });
    const ds = [...svg.querySelectorAll("[data-testid='cum-2d-sa-ban'],[data-testid='toa-2d-sa-ban']")];
    const iCumCuoi = ds.map((e) => e.getAttribute("data-testid")).lastIndexOf("cum-2d-sa-ban");
    const iToaDau = ds.map((e) => e.getAttribute("data-testid")).indexOf("toa-2d-sa-ban");
    expect(iCumCuoi).toBeLessThan(iToaDau);
  });
});

describe("★★★ H3 — NHÃN: ba tên công ty là tiêu chí nghiệm thu, không phải trang trí", () => {
  it("3 nhãn cụm mang ĐÚNG tên công ty, 12 nhãn toà mang tên toà", () => {
    const { q } = ve({ soMay: 0, saBan: true });
    const cum = q("nhan-cum-sa-ban-2d").map((e) => e.textContent);
    expect(cum.sort()).toEqual(["Công ty A", "Công ty B", "Công ty C"]);
    expect(q("nhan-toa-sa-ban-2d")).toHaveLength(12);
  });

  it("★ nhãn vẽ SAU hình — chữ nằm dưới khối là chữ không đọc được", () => {
    const { svg } = ve({ soMay: 0, saBan: true });
    const ds = [...svg.querySelectorAll("[data-testid^='toa-2d-'],[data-testid^='nhan-']")];
    const ten = ds.map((e) => e.getAttribute("data-testid") ?? "");
    expect(ten.lastIndexOf("toa-2d-sa-ban")).toBeLessThan(ten.indexOf("nhan-cum-sa-ban-2d"));
  });

  it("★★★ cỡ chữ TỈ LỆ với sa bàn, không phải hằng mét — hằng sẽ bé đi khi sa bàn to ra", () => {
    const a = ve({ soMay: 0, saBan: true });
    const cuA = Number((a.q("nhan-cum-sa-ban-2d")[0] as SVGTextElement).getAttribute("font-size"));
    a.r.unmount();
    // Sa bàn rộng GẤP ĐÔI ⇒ cỡ chữ (mét) phải gấp đôi để ra CÙNG số pixel.
    const may: MayTrongLo[] = [];
    const sb = dungSaBan();
    const r = render(
      <CanhVanHanh2D
        may={may}
        trangThaiTheoMay={new Map()}
        maTheoMay={new Map()}
        machineIdChon={null}
        onChonMay={() => {}}
        sanRongM={RONG_M * 2}
        sanSauM={SAU_M * 2}
        saBan={sb.toa}
        saBanCum={sb.cum}
        nhanTrangThai={(tt) => tt}
        ariaLabel="cảnh 2D"
      />,
    );
    const cuB = Number(
      (r.container.querySelector("[data-testid='nhan-cum-sa-ban-2d']") as SVGTextElement).getAttribute(
        "font-size",
      ),
    );
    expect(cuB / cuA).toBeCloseTo(2, 1);
  });
});

describe("★★★ H4 — MỘT BẢNG MÀU CHO CẢ HAI CHẾ ĐỘ", () => {
  it("biểu tượng toà dùng đúng `MAU_BIEU_TUONG_TOA`, nền cụm đúng `NEN_CUM_*`", () => {
    // Hai bảng màu song song là đúng cách mà hai chế độ lại tách ra lần nữa —
    // lần này ở màu thay vì ở đơn vị vẽ.
    const { q } = ve({ soMay: 0, saBan: true });
    const toa = q("toa-2d-sa-ban")[0] as SVGRectElement;
    expect([MAU_BIEU_TUONG_TOA.sang, MAU_BIEU_TUONG_TOA.toi]).toContain(toa.getAttribute("fill"));
    const cum = q("cum-2d-sa-ban") as SVGRectElement[];
    for (const c of cum) {
      const f = c.getAttribute("fill") ?? "";
      expect(
        [...NEN_CUM_SANG, ...(["#27364b", "#1f2c3e", "#2f4058", "#18222f"] as const)],
        `màu lạ: ${f}`,
      ).toContain(f);
    }
  });

  it("★ KHÔNG tô biểu tượng theo SẮC trạng thái — xanh/đỏ ở màn này có nghĩa khác (§10.1)", () => {
    const { q } = ve({ soMay: 0, saBan: true });
    const mau = new Set((q("toa-2d-sa-ban") as SVGRectElement[]).map((e) => e.getAttribute("fill")));
    expect(mau.size).toBe(1);
  });
});
