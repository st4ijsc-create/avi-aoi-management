// @vitest-environment jsdom
//
// daiCanhBaoTieuDeVsDanhSach.dom.test.tsx — ★★★ PHÂN XỬ PH-38
// ("tiêu đề đếm toàn phạm vi, danh sách vẽ một phần")
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ VÌ SAO MỘT TỆP RIÊNG, KHÔNG NHÉT VÀO `DaiCanhBao.dom.test.tsx`
// ════════════════════════════════════════════════════════════════════════════
// Tệp cũ (38 ca) đo #12/#13/#14/#15 — *luật có được gọi không*. Tệp này đo MỘT
// câu khác hẳn: **con số người dùng đọc có ứng với thứ trước mắt họ không**, và
// nó phải mang theo cả **thiết bị đo của QA** để phân xử được lời khai PH-38.
// Trộn hai câu hỏi vào một tệp làm ca nào vỡ không còn nói được vỡ vì cái gì.
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ BA GIẢ THUYẾT SINH RA CÙNG MỘT TRIỆU CHỨNG — CHỈ ĐO MỚI TÁCH ĐƯỢC
// ════════════════════════════════════════════════════════════════════════════
// Nguyên văn PH-38 (`.qa-tapdoan/PHAT-HIEN.md:320`): *"Giám đốc thấy Alarms (55)
// phía trên 15 dòng, tất cả đều Công ty A; kỹ thuật thấy Today (35) trên 15
// dòng. 40 dòng biến mất không câu nào nói ra."*
//
//   G1 · LỆCH TIÊU ĐỀ/DANH SÁCH — `DaiCanhBao.tsx` đếm `theoPhamVi` (TRƯỚC bộ
//        lọc mức) nhưng vẽ `theoMuc` (SAU). Bấm một chip mức ⇒ hai số lệch thật.
//   G2 · ẢO GIÁC CỦA PHÉP ĐO — ô cuộn chỉ cho thấy ~5 hàng; mọi hàng VẪN ở
//        trong DOM (không ảo hoá: 0 kết quả cho `virtual|react-window`).
//   G3 · DÒNG NHÀ MÁY KHÁC IM LẶNG — `andon.active` không nhận `factoryId`, nên
//        `maTheoMay` (chỉ chứa máy của nhà máy ĐANG nạp) tra trượt ⇒ hai ô danh
//        tính ra `null` ⇒ dòng ấy **không nói gì**, trông như dòng của nhà máy
//        đang xem.
//
// ★★★ VÀ CÓ MỘT MỆNH ĐỀ SỐ HỌC BÁC BỎ THẲNG VẾ "Today (35) trên 15 dòng":
//   `DaiCanhBao.tsx` in tiêu đề nhóm bằng `nhom.homNay.length` rồi `map` trên
//   **CHÍNH mảng ấy**. Một tiêu đề nhóm KHÔNG THỂ nói dối về danh sách của
//   chính nó. Ca `#A3` ghim mệnh đề này bằng số, không bằng lý lẽ.
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ THIẾT BỊ ĐO CỦA QA ĐƯỢC TÁI HIỆN NGUYÊN VĂN Ở ĐÂY (ca `#A2`)
// ════════════════════════════════════════════════════════════════════════════
// `.qa-tapdoan/do-cuoi-P2b.mjs:31-37` đếm dòng bằng
//     querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]')
// rồi gom vào `Map` **khoá theo `data-ma-may`**. Hai khuyết tật CỘNG DỒN:
//   (a) `DaiCanhBao.tsx` cố ý dùng `data-ma-may={c.maMay ?? undefined}` — React
//       **BỎ HẲN thuộc tính** khi `undefined` (docblock PH-30 ghi rõ chủ đích:
//       "chưa biết" = thuộc tính vắng mặt). Nên bộ chọn ấy nhặt **đúng và chỉ**
//       những dòng tra được mã máy = đúng nhà máy đang nạp.
//   (b) khoá `Map` theo mã máy ⇒ hai cảnh báo trên cùng một máy gộp còn một.
// ⇒ Bộ chọn tự nó **định nghĩa** ra kết cục "chỉ 15 dòng, cả 15 của Công ty A".
//   Đó không phải phép đo về sản phẩm, đó là phép đo về chính bộ chọn (G7).
//
// ★ CHỐNG TỰ THOẢ: mỗi ca khẳng định KÍCH THƯỚC ĐẦU VÀO trước khi khẳng định
//   kết cục; không ca nào xanh trên tập rỗng; `#A2` là đối chứng DƯƠNG cho bộ
//   đếm (nó bắt bộ đếm phải cho ra HAI số khác nhau trên cùng một cây DOM).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DaiCanhBao } from "./DaiCanhBao";
import type { CanhBaoDai } from "./daiCanhBaoLogic";

/*
 * ⚠ KHUÔN `t()` CỦA TỆP NÀY — xem cảnh báo trong `DaiCanhBao.tsx:293-298`:
 *   `DaiCanhBao.tsx` CẤM `defaultValue` chuỗi ở đối số thứ hai. Mock dưới đây in
 *   kèm THAM SỐ để ghim được nội suy (`{{hien}}/{{tong}}`), nên một ca nào đó
 *   đổi sang `t(khoa, "chuỗi")` sẽ hiện ra dưới dạng nhãn `[0=c,1=h,…]` lạ mắt
 *   thay vì lặng lẽ đi qua.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o !== undefined && o !== null
        ? `${k}[${Object.keys(o)
            .sort()
            .map((x) => `${x}=${String((o as Record<string, unknown>)[x])}`)
            .join(",")}]`
        : k,
  }),
}));

afterEach(() => cleanup());

const BAY_GIO = 1_757_000_000_000;
const GIO = 3_600_000;

function cb(sua: Partial<CanhBaoDai> & { idNguon: number }): CanhBaoDai {
  return {
    nguon: "andon",
    muc: "red",
    pha: "raised",
    tieuDe: `Un tac tai tram (QATD) ${sua.idNguon}`,
    luc: BAY_GIO - GIO,
    capNhatLuc: BAY_GIO - GIO,
    machineId: null,
    lineId: null,
    stationId: null,
    workshopId: null,
    maMay: null,
    tenNhaMay: null,
    ...sua,
  };
}

/**
 * ★★★ KỊCH BẢN TẬP ĐOÀN, DỰNG LẠI ĐÚNG SỐ CỦA QA lần 11
 * (`.qa-tapdoan/BANG-CUOI.md:22` — "A 15 · B 20 · C 20", tổng **55**).
 *
 * Điểm mấu chốt: chỉ máy của **Công ty A** có trong `maTheoMay` của trang (vì
 * `mayVanHanh` bắt nguồn từ `twinCanh.canhThietKe({ factoryId })`), nên 40 dòng
 * của B và C ra khỏi `chuanHoaHang` với `maMay = null`, `tenNhaMay = null` —
 * y hệt thực tế, KHÔNG phải một tập bịa cho dễ xanh.
 */
function kichBanTapDoan(): CanhBaoDai[] {
  const ra: CanhBaoDai[] = [];
  // Công ty A — nhà máy ĐANG nạp cảnh ⇒ tra được danh tính. 15 dòng, mức `red`.
  for (let i = 0; i < 15; i += 1) {
    ra.push(
      cb({
        idNguon: 100 + i,
        muc: "red",
        machineId: 1000 + i,
        maMay: `QATD-A-M${String(i).padStart(2, "0")}`,
        tenNhaMay: "Công ty A",
        luc: BAY_GIO - GIO - i * 1000,
      }),
    );
  }
  // Công ty B — NGOÀI lượt nạp ⇒ tra trượt. 20 dòng, mức `yellow`.
  for (let i = 0; i < 20; i += 1) {
    ra.push({ ...cb({ idNguon: 200 + i, muc: "yellow", machineId: 2000 + i }), luc: BAY_GIO - GIO - 100_000 - i * 1000 });
  }
  // Công ty C — NGOÀI lượt nạp. 20 dòng, mức `call`.
  for (let i = 0; i < 20; i += 1) {
    ra.push({ ...cb({ idNguon: 300 + i, muc: "call", machineId: 3000 + i }), luc: BAY_GIO - GIO - 200_000 - i * 1000 });
  }
  return ra;
}

/** Mọi dòng cảnh báo ĐANG Ở TRONG DOM (khuôn đếm chuẩn của mọi lưới cũ). */
function dong(): HTMLElement[] {
  return screen.queryAllByTestId(/^canh-bao-/);
}

/** Con số trong ngoặc ở tiêu đề dải — đọc theo CHỮ, không theo `data-*`, vì đó
 *  đúng là thứ người dùng nhìn thấy. */
function soTrenTieuDe(): string {
  const chu = screen.getByTestId("dai-canh-bao").textContent ?? "";
  const m = /twin3d\.daiCanhBao\.tieuDe(?:\[[^\]]*\])?\s*\(([^)]*)\)/.exec(chu);
  expect(m, `không đọc được con số tiêu đề trong: ${chu.slice(0, 200)}`).not.toBeNull();
  return (m as RegExpExecArray)[1].trim();
}

/** Con số trong ngoặc của một tiêu đề NHÓM (`nhom-hom-nay` / `nhom-ton-dong`). */
function soTrenNhom(testId: string): number {
  const chu = screen.getByTestId(testId).textContent ?? "";
  const m = /\((\d+)\)/.exec(chu);
  expect(m, `không đọc được con số nhóm ${testId} trong: ${chu}`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

function ve(sua: Partial<React.ComponentProps<typeof DaiCanhBao>> = {}) {
  return render(<DaiCanhBao seed={[]} bayGio={BAY_GIO} {...sua} />);
}

// ═══════════════════════════════════════════════════════════════════════════
// §A — PHÂN XỬ: ba giả thuyết, mỗi giả thuyết một phép đo
// ═══════════════════════════════════════════════════════════════════════════

describe("★★★ §A PHÂN XỬ PH-38 — cái gì thật sự xảy ra", () => {
  it("#A1 · G2 — 55 vào, phamVi=null, chonMuc=tat_ca ⇒ DOM có ĐỦ 55 dòng, tiêu đề in 55", () => {
    const seed = kichBanTapDoan();
    // KÍCH THƯỚC ĐẦU VÀO trước, kết cục sau (chống ca xanh trên tập rỗng).
    expect(seed).toHaveLength(55);
    expect(new Set(seed.map((c) => c.idNguon)).size).toBe(55);

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });

    expect(dong()).toHaveLength(55);
    expect(soTrenTieuDe()).toBe("55");
  });

  it("#A2 · ĐỐI CHỨNG DƯƠNG — thiết bị đo của QA (`do-cuoi-P2b.mjs`) tự sinh ra con số 15", () => {
    const seed = kichBanTapDoan();
    expect(seed.filter((c) => c.maMay !== null)).toHaveLength(15); // chỉ Công ty A tra được
    expect(seed.filter((c) => c.maMay === null && c.machineId !== null)).toHaveLength(40);

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });

    // ── Bộ đếm ĐÚNG: mọi hàng, bất kể tra được danh tính hay không.
    const thatSuVe = dong().length;

    // ── Bộ đếm của QA, chép NGUYÊN VĂN `do-cuoi-P2b.mjs:31-37`.
    const thay = new Map<string | null, unknown>();
    for (const e of document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]')) {
      thay.set(e.getAttribute("data-ma-may"), { nhaMay: e.getAttribute("data-nha-may") });
    }
    const nhuQaDem = thay.size;

    // HAI SỐ KHÁC NHAU trên CÙNG một cây DOM ⇒ chênh lệch nằm ở BỘ CHỌN.
    expect(thatSuVe).toBe(55);
    expect(nhuQaDem).toBe(15);
    expect(thatSuVe - nhuQaDem).toBe(40); // đúng "40 dòng biến mất" của PH-38
  });

  it("#A3 · SỐ HỌC BÁC BỎ 'Today (35) trên 15 dòng' — tiêu đề nhóm KHÔNG thể nói dối về nhóm nó", () => {
    const seed = kichBanTapDoan();
    expect(seed).toHaveLength(55);
    expect(seed.every((c) => BAY_GIO - c.luc <= 86_400_000)).toBe(true); // tất cả trong 24h

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });

    expect(soTrenNhom("nhom-hom-nay")).toBe(55);
    expect(soTrenNhom("nhom-hom-nay")).toBe(dong().length);
    expect(screen.queryByTestId("nhom-ton-dong")).toBeNull();
  });

  it("#A3b · và với HAI nhóm, tổng hai tiêu đề nhóm = số hàng trong DOM", () => {
    const seed = kichBanTapDoan().map((c, i) =>
      // 12 dòng đẩy quá 24h ⇒ rơi sang nhóm tồn đọng.
      i % 5 === 0 ? { ...c, luc: BAY_GIO - 86_400_000 - GIO } : c,
    );
    expect(seed).toHaveLength(55);
    expect(seed.filter((c) => BAY_GIO - c.luc > 86_400_000)).toHaveLength(11);

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });

    const tong = soTrenNhom("nhom-hom-nay") + soTrenNhom("nhom-ton-dong");
    expect(tong).toBe(55);
    expect(tong).toBe(dong().length);
  });

  it("#A4 · G1 XÁC NHẬN — bấm chip mức: tiêu đề phải NÓI ĐÚNG thứ đang vẽ", () => {
    const seed = kichBanTapDoan();
    expect(seed.filter((c) => c.muc === "yellow")).toHaveLength(20);
    expect(seed).toHaveLength(55);

    ve({ seed, phamVi: null, chonMuc: "yellow" });

    // Thứ đang VẼ là 20.
    expect(dong()).toHaveLength(20);
    // ⇒ con số ở tiêu đề PHẢI nói 20 (và được phép nói thêm mẫu số 55).
    const so = soTrenTieuDe();
    expect(so, `tiêu đề in "${so}" trong khi màn đang vẽ 20 hàng`).toMatch(/\b20\b/);
    // Và KHÔNG được giấu mất 35 dòng kia: mẫu số vẫn phải có mặt.
    expect(so).toMatch(/\b55\b/);
  });

  it("#A4b · không lọc gì ⇒ tiêu đề in ĐÚNG MỘT số (không bịa ra mẫu số thừa)", () => {
    const seed = kichBanTapDoan();
    expect(seed).toHaveLength(55);
    ve({ seed, phamVi: null, chonMuc: "tat_ca" });
    expect(dong()).toHaveLength(55);
    expect(soTrenTieuDe()).toBe("55");
  });

  it("#A5 · G3 XÁC NHẬN — 40 dòng nhà máy khác phải TỰ NÓI ra, không im lặng", () => {
    const seed = kichBanTapDoan();
    const ngoai = seed.filter((c) => c.machineId !== null && c.maMay === null);
    expect(ngoai).toHaveLength(40);

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });
    expect(dong()).toHaveLength(55);

    // MỌI dòng phải có dòng phụ danh tính — 15 dòng nói tên máy+công ty,
    // 40 dòng nói "ngoài lượt nạp này". 0 dòng im lặng.
    expect(screen.queryAllByTestId(/^danh-tinh-/)).toHaveLength(55);

    const ngoaiLuot = screen.queryAllByTestId(/^canh-bao-/).filter(
      (e) => e.getAttribute("data-danh-tinh") === "ngoai-luot-nap",
    );
    expect(ngoaiLuot).toHaveLength(40);
    for (const e of ngoaiLuot) {
      expect(e.textContent ?? "").toContain("twin3d.daiCanhBao.ngoaiLuotNap");
    }
  });

  it("#A5b · CA ÂM — dòng KHÔNG gắn máy (machineId=null) KHÔNG bị gán nhãn 'ngoài lượt nạp'", () => {
    // NT-3 (`locTheoPhamVi` docblock): cảnh báo không gắn trục nào vẫn phải hiện.
    // "Không có máy" và "máy ở nhà máy khác" là HAI sự thật khác nhau; nói nhầm
    // câu thứ hai cho ca thứ nhất là bịa ra một nhà máy không tồn tại.
    const seed = [
      cb({ idNguon: 900, machineId: null }),
      cb({ idNguon: 901, machineId: 2001 }),
      cb({ idNguon: 902, machineId: 1001, maMay: "QATD-A-M01", tenNhaMay: "Công ty A" }),
    ];
    expect(seed).toHaveLength(3);

    ve({ seed, phamVi: null, chonMuc: "tat_ca" });
    expect(dong()).toHaveLength(3);

    const theoId = (id: number) => screen.getByTestId(`canh-bao-andon-${id}`);
    expect(theoId(900).getAttribute("data-danh-tinh")).toBe("khong-gan-may");
    expect(theoId(901).getAttribute("data-danh-tinh")).toBe("ngoai-luot-nap");
    expect(theoId(902).getAttribute("data-danh-tinh")).toBe("co");
    expect(theoId(900).textContent ?? "").not.toContain("ngoaiLuotNap");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B — BẤT BIẾN sau vá: con số ở tiêu đề **không thể** rời khỏi số hàng đang vẽ
// ═══════════════════════════════════════════════════════════════════════════

describe("★★★ §B Bất biến — `data-so-hien` của tiêu đề = SỐ HÀNG thật trong DOM", () => {
  /**
   * Mọi tổ hợp đáng kể của bộ lọc, đo trên CÙNG một tập 55.
   *
   * ★★★ `chu` LÀ CỘT BẮT BUỘC, không phải thứ trang trí — và nó có mặt vì một
   *   lần ablation đã bắt quả tang lưới này: gỡ riêng `nhanTong` (chuỗi NGƯỜI
   *   DÙNG ĐỌC) mà giữ `data-so-hien` thì §B **vẫn xanh 6/6**. Tức bản đầu của
   *   §B đo đúng cái mà bản vá tự khai, chứ không đo cái trên màn — lớp lỗi
   *   "thiết bị đo cùng nguồn với thứ nó đo". Hai cột `chu` + `data-*` là hai
   *   đường độc lập, và ca chỉ xanh khi CẢ HAI khớp.
   */
  const CA: ReadonlyArray<{
    ten: string;
    chonMuc: "tat_ca" | "red" | "call" | "yellow" | "green";
    hang: number;
    chu: string;
  }> = [
    { ten: "tat_ca", chonMuc: "tat_ca", hang: 55, chu: "55" },
    { ten: "red", chonMuc: "red", hang: 15, chu: "15 / 55" },
    { ten: "yellow", chonMuc: "yellow", hang: 20, chu: "20 / 55" },
    { ten: "call", chonMuc: "call", hang: 20, chu: "20 / 55" },
  ];

  for (const c of CA) {
    it(`#B1·${c.ten} — màn đọc "${c.chu}", DOM có ${c.hang} hàng, hai đường đo khớp`, () => {
      const seed = kichBanTapDoan();
      expect(seed).toHaveLength(55);
      ve({ seed, phamVi: null, chonMuc: c.chonMuc });

      const soHang = dong().length;
      expect(soHang, "kích thước đầu ra phải khác 0 — ca rỗng không chứng minh gì").toBe(c.hang);
      expect(soHang).toBeGreaterThan(0);

      // Đường 1 — CHỮ trên màn (thứ người dùng thật sự đọc).
      expect(soTrenTieuDe()).toBe(c.chu);
      // Đường 2 — thuộc tính cho phép đo ngoài (e2e/Playwright).
      const tieuDe = screen.getByTestId("dai-tieu-de");
      expect(tieuDe.getAttribute("data-so-hien")).toBe(String(soHang));
      expect(tieuDe.getAttribute("data-so-tong")).toBe("55");
      // Và tử số trong CHỮ phải là chính con số hàng — không chỉ "có mặt đâu đó".
      expect(c.chu.split("/")[0].trim()).toBe(String(soHang));
    });
  }

  it("#B2 · mức `green` KHÔNG có dòng nào ⇒ tiêu đề khai 0, và màn nói 'không có ở mức này'", () => {
    const seed = kichBanTapDoan();
    expect(seed.filter((c) => c.muc === "green")).toHaveLength(0);
    expect(seed).toHaveLength(55);

    ve({ seed, phamVi: null, chonMuc: "green" });

    expect(dong()).toHaveLength(0);
    expect(screen.getByTestId("dai-tieu-de").getAttribute("data-so-hien")).toBe("0");
    expect(screen.getByTestId("dai-tieu-de").getAttribute("data-so-tong")).toBe("55");
    // Phải là câu "có cảnh báo, chỉ không ở mức này" — KHÔNG phải "không có cảnh báo".
    expect(screen.getByTestId("dai-trong-muc")).toBeInTheDocument();
    expect(screen.queryByTestId("dai-trong")).toBeNull();
  });

  it("#B3 · `—` khi CHƯA ĐO ĐƯỢC: không có số nào bị bịa ra (G15)", () => {
    const seed = kichBanTapDoan();
    expect(seed).toHaveLength(55);
    ve({ seed, khongDoDuoc: true });
    expect(soTrenTieuDe()).toBe("—");
    expect(screen.getByTestId("dai-tieu-de").getAttribute("data-so-hien")).toBeNull();
    expect(screen.getByTestId("dai-canh-bao-cuon").textContent?.trim()).toBe("—");
  });

  it("#B4 · lọc theo NHÁNH cũng phải giữ bất biến (hai bộ lọc chồng nhau)", () => {
    const seed = kichBanTapDoan();
    expect(seed).toHaveLength(55);
    // Nhánh chỉ chứa 5 máy đầu của Công ty A.
    const phamVi = {
      workshopIds: new Set<number>(),
      lineIds: new Set<number>(),
      stationIds: new Set<number>(),
      machineIds: new Set<number>([1000, 1001, 1002, 1003, 1004]),
    };
    ve({ seed, phamVi, chonMuc: "tat_ca" });

    expect(dong()).toHaveLength(5);
    const tieuDe = screen.getByTestId("dai-tieu-de");
    // Mẫu số nay là TẬP TRONG NHÁNH (5), không phải 55: `nhanPhamVi` là câu nói
    // ra chuyện ấy, và bộ lọc nhánh là bộ lọc NGƯỜI DÙNG CHỌN chứ không phải
    // một phép cắt lặng lẽ như bộ lọc mức.
    expect(tieuDe.getAttribute("data-so-hien")).toBe("5");
    expect(tieuDe.getAttribute("data-so-tong")).toBe("5");
    expect(soTrenTieuDe()).toBe("5");
  });
});
