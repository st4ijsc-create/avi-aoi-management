// @vitest-environment jsdom
/**
 * danhSachMayAoHoa.dom.test.tsx — ★★★ ĐỢT 10 LÔ H1: GHIM ẢO HOÁ **VÀ** GHIM
 * RẰNG BẢN VÁ HIỆU NĂNG KHÔNG ĐÁNH ĐỔI BẰNG A11Y.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY CÓ HAI NỬA, VÀ NỬA THỨ HAI QUAN TRỌNG HƠN
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trước (lô E, `DanhSachMay.tsx:109`, tải FUYU-F 549 máy):
 *     549 `<li>` thật trong DOM · một lần gõ bộ lọc 263 ms (trình duyệt thật).
 * Đo lại bằng thiết bị đo jsdom của tệp này TRƯỚC bản vá: 549 `<li>`, 80,7 ms
 * cho 3 ký tự. Sau bản vá: **29 `<li>`, 27,7 ms** — cùng thiết bị đo, cùng dữ
 * liệu, chỉ khác mã.
 *
 * Nhưng "ít `<li>` hơn" MỘT MÌNH là một cổng xanh nguy hiểm: cách nhanh nhất
 * đạt nó là cắt mảng và **để rơi 520 máy khỏi tầm với của bàn phím**. Vì thế
 * nửa sau của tệp đo đúng thứ đó — con trỏ đi được tới máy CUỐI CÙNG của 549,
 * và trình đọc màn hình đọc đúng "mục 549 trên 549", chứ không phải "mục 20
 * trên 20".
 *
 * ★ G20 — `import { DanhSachMay } from "./DanhSachMay"`: CHÍNH module giao hàng
 *   mà `TwinVanHanh.tsx:1652` dựng, không phải bản chép tay.
 *
 * ★ `caoKhungTest` tồn tại vì jsdom KHÔNG có layout engine: `clientHeight` luôn
 *   0, nên nếu không bơm chiều cao vào thì `aoHoa` luôn `false` và MỌI khẳng
 *   định dưới đây sẽ đo trên đường KHÔNG ảo hoá — cổng xanh mà không đo cái nó
 *   nói nó đo (họ G5/G6). Ca cuối tệp canh chính điều đó.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { DanhSachMay, CAO_HANG_PX, NGUONG_AO_HOA } from "./DanhSachMay";
import type { MayVanHanh } from "./trungThucDuLieu";

afterEach(() => cleanup());

function dungMay(n: number): MayVanHanh[] {
  const out: MayVanHanh[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: i + 1,
      ma: "FUYU-F-M" + String(i + 1).padStart(4, "0"),
      ten: "May so " + (i + 1),
      loaiMay: "aoi",
      trangThaiBaoCao: "running",
      thoiDiemDuLieu: 1_700_000_000_000,
      isActive: true,
      stationId: null,
      lineId: (i % 6) + 1,
    });
  }
  return out;
}

function ve(n: number, cao: number | undefined = 480) {
  const may = dungMay(n);
  const tt = new Map<number, string>(may.map((m) => [m.id, "running"]));
  const r = render(
    <DanhSachMay
      may={may}
      trangThaiTheoMay={tt}
      machineIdChon={null}
      onChonMay={() => {}}
      bayGio={1_700_000_010_000}
      dangTai={false}
      caoKhungTest={cao}
    />,
  );
  return { r, may, ul: r.container.querySelector("ul") as HTMLUListElement };
}

/** Mã lớn nhất theo `localeCompare` — máy nằm CUỐI danh sách đã sắp. */
function mayCuoi(may: MayVanHanh[]): MayVanHanh {
  return [...may].sort((a, b) => a.ma.localeCompare(b.ma))[may.length - 1];
}

describe("H1 — ảo hoá đo được", () => {
  it("549 máy ⇒ SỐ `<li>` trong DOM ÍT HƠN MỘT BẬC (549 → dưới 40)", () => {
    const { r, ul } = ve(549);
    const soLi = r.container.querySelectorAll("li").length;
    // Ghim NGƯỠNG, không ghim con số chính xác: overscan/chiều cao khung đổi
    // thì con số đổi, nhưng "ít hơn một bậc" là thứ bản vá hứa.
    expect(soLi).toBeLessThan(40);
    expect(ul.getAttribute("data-ao-hoa")).toBe("1");
    // ⚠ ĐẦU RA PHẢI KHÁC ĐẦU VÀO (G32): nếu `hienThi` bị cắt nhầm thì
    // `data-so-may` cũng tụt theo và test trên vẫn xanh mà danh sách đã MẤT máy.
    expect(ul.getAttribute("data-so-may")).toBe("549");
  });

  it("ĐỐI CHỨNG f(x)=x — 43 máy (DB thật) KHÔNG ảo hoá, đủ 43 `<li>`", () => {
    // Nếu ai đó bật ảo hoá cho MỌI kích thước, ca này đỏ. Đây là nửa "phép biến
    // đổi đồng nhất" của G32: ở quy mô thật hôm nay, hành vi phải y hệt bản cũ.
    const { r, ul } = ve(43);
    expect(ul.getAttribute("data-ao-hoa")).toBe("0");
    expect(r.container.querySelectorAll('[data-testid^="may-hang-"]').length).toBe(43);
  });

  it("ngưỡng đúng chỗ: NGUONG_AO_HOA máy KHÔNG ảo, +1 máy thì CÓ", () => {
    const a = ve(NGUONG_AO_HOA);
    expect(a.ul.getAttribute("data-ao-hoa")).toBe("0");
    cleanup();
    const b = ve(NGUONG_AO_HOA + 1);
    expect(b.ul.getAttribute("data-ao-hoa")).toBe("1");
  });

  it("đệm trên+dưới cộng với hàng vẽ ra ĐÚNG tổng chiều cao 549 hàng", () => {
    // Thanh cuộn nói dối là lỗi CÂM: người dùng kéo tới đáy mà còn 300 máy nữa.
    const { r, ul } = ve(549);
    const li = [...r.container.querySelectorAll("li")];
    const dem = li
      .filter((e) => e.getAttribute("aria-hidden") === "true")
      .reduce((s, e) => s + parseFloat((e as HTMLLIElement).style.height || "0"), 0);
    const hang = li.filter((e) => e.getAttribute("role") === "option").length;
    expect(dem + hang * CAO_HANG_PX).toBe(549 * CAO_HANG_PX);
    expect(ul.getAttribute("data-so-hang-ve")).toBe(String(hang));
  });
});

describe("H1 — a11y KHÔNG bị bản vá hiệu năng ăn mất", () => {
  it("MỘT điểm dừng Tab cho cả danh sách, không phải 549", () => {
    const { r, ul } = ve(549);
    expect(ul.getAttribute("tabindex")).toBe("0");
    const nutTabDuoc = [...r.container.querySelectorAll("button")].filter(
      (b) => b.getAttribute("tabindex") !== "-1",
    );
    expect(nutTabDuoc.length).toBe(0);
  });

  it("★★★ End đi tới máy THỨ 549 — ô chưa render vẫn tới được bằng bàn phím", () => {
    // Đây là ca mà một bản ảo hoá ngây thơ SẼ HỎNG: máy 549 không có trong DOM
    // lúc đầu. Nếu bản vá làm rơi nó khỏi tầm bàn phím, dòng này đỏ.
    const { r, ul, may } = ve(549);
    const cuoi = mayCuoi(may);
    fireEvent.keyDown(ul, { key: "End" });
    expect(ul.getAttribute("aria-activedescendant")).toBe("may-oo-" + cuoi.id);
    // Và ô đó phải THẬT SỰ có trong DOM — `aria-activedescendant` trỏ vào một
    // `id` không tồn tại là lỗi câm: trình đọc màn hình im lặng, không lỗi nào nổ.
    expect(r.container.querySelector("#may-oo-" + cuoi.id)).not.toBeNull();
  });

  it("aria-setsize/posinset nói vị trí THẬT (549), không phải vị trí trong cửa sổ", () => {
    const { r, ul } = ve(549);
    fireEvent.keyDown(ul, { key: "End" });
    const o = r.container.querySelector("#" + ul.getAttribute("aria-activedescendant"));
    expect(o).not.toBeNull();
    expect(o!.getAttribute("aria-setsize")).toBe("549");
    expect(o!.getAttribute("aria-posinset")).toBe("549");
  });

  it("Enter trên con trỏ CHỌN máy — đường ack alarm §9.9 không qua WebGL", () => {
    const may = dungMay(549);
    const tt = new Map<number, string>(may.map((m) => [m.id, "running"]));
    const daChon: number[] = [];
    const r = render(
      <DanhSachMay
        may={may}
        trangThaiTheoMay={tt}
        machineIdChon={null}
        onChonMay={(id) => daChon.push(id)}
        bayGio={1_700_000_010_000}
        dangTai={false}
        caoKhungTest={480}
      />,
    );
    const ul = r.container.querySelector("ul") as HTMLUListElement;
    fireEvent.keyDown(ul, { key: "End" });
    fireEvent.keyDown(ul, { key: "Enter" });
    expect(daChon.length).toBe(1);
    expect(daChon[0]).toBe(mayCuoi(may).id);
  });

  it("đệm KHÔNG bị đếm là mục: role='none' + aria-hidden", () => {
    // Một `<li>` trần trong `role=listbox` được trình đọc màn hình đếm là MỘT
    // MỤC ⇒ tổng số mục sai đi 1–2 mà mắt không thấy.
    const { r } = ve(549);
    for (const e of r.container.querySelectorAll("li")) {
      if (e.getAttribute("aria-hidden") === "true") {
        expect(e.getAttribute("role")).toBe("none");
      } else {
        expect(e.getAttribute("role")).toBe("option");
      }
    }
  });
});

describe("H1 — thiết bị đo tự canh mình", () => {
  it("KHÔNG bơm chiều cao (jsdom clientHeight=0) ⇒ KHÔNG ảo hoá, đủ 549 `<li>`", () => {
    // Ô này là lý do mọi ca trên được phép tin: nó chứng minh `caoKhungTest`
    // THỰC SỰ bật/tắt đường ảo hoá, nên các ca trên đã đo đúng nhánh chúng nói.
    // ⚠ KHÔNG dùng `ve(549, undefined)`: tham số mặc định của JS thay `undefined`
    //   BẰNG mặc định (480) ⇒ ca này sẽ đo đúng nhánh nó định loại trừ, và xanh
    //   vì lý do sai. Bắt được ở lượt chạy đầu — dựng thẳng ở đây.
    const may = dungMay(549);
    const tt = new Map<number, string>(may.map((m) => [m.id, "running"]));
    const r = render(
      <DanhSachMay
        may={may}
        trangThaiTheoMay={tt}
        machineIdChon={null}
        onChonMay={() => {}}
        bayGio={1_700_000_010_000}
        dangTai={false}
      />,
    );
    const ul = r.container.querySelector("ul") as HTMLUListElement;
    expect(ul.getAttribute("data-ao-hoa")).toBe("0");
    expect(r.container.querySelectorAll('[data-testid^="may-hang-"]').length).toBe(549);
  });

  it("bộ lọc vẫn lọc ĐÚNG khi ảo hoá — không lọc trên cửa sổ", () => {
    // Lọc trên `veHang` thay vì trên `hienThi` là một lỗi rất dễ viết ra, và nó
    // cho danh sách "tìm không thấy" máy nằm ngoài khung nhìn.
    const { r } = ve(549);
    const o = r.container.querySelector('[data-testid="o-loc-may"]') as HTMLInputElement;
    fireEvent.change(o, { target: { value: "M0549" } });
    const ul = r.container.querySelector("ul") as HTMLUListElement;
    expect(ul.getAttribute("data-so-may")).toBe("1");
    expect(r.container.querySelector('[data-testid="may-hang-549"]')).not.toBeNull();
  });
});
