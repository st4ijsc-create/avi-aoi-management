import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * noiChoGoi.unit.test.ts — ★★★ G16: **HÀM TỒN TẠI MÀ KHÔNG AI GỌI = CHƯA XONG**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CẦN MỘT TỆP TEST ĐỌC MÃ NGUỒN — VÀ NÓ *KHÔNG* ĐO ĐƯỢC GÌ KHÁC
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 7 đo được BỐN tính năng "có mã, có test, qua `check`, qua `build`, qua 994
 * test, và giao được **số 0**". Hai trong bốn nằm đúng ở đây:
 *
 *   L-1  `nhipHoiMs` — hàm đúng, test xanh, **0 chỗ gọi sản phẩm**.
 *   L-2  `wip={[]}`  — lớp phủ dựng xong, render thật, **hằng rỗng viết cứng**.
 *
 * Cả hai đều **vô hình với mọi test đơn vị**, vì test đơn vị đo MODULE, còn
 * khuyết tật nằm ở **CHỖ NỐI giữa module và trang**. `TwinVanHanh.tsx` là một
 * component 1.600 dòng phụ thuộc tRPC + socket + wouter + WebGL; dựng nó trong
 * jsdom để đo hai dòng JSX là đổi một lỗ hổng lấy một dàn mock mà chính dàn mock
 * đó mới là thứ được đo (G20 hỏi: *"xoá sạch mã sản phẩm, test này có đỏ không?"*
 * — với một dàn mock đủ dày, câu trả lời là KHÔNG).
 *
 * Nên tệp này đo đúng MỘT thứ và khai thẳng ra: **văn bản chỗ nối**. Nó KHÔNG
 * chứng minh lớp phủ vẽ đúng (đó là việc của `wipTram.unit.test.ts` và của
 * nghiệm thu thị giác). Nó chỉ chặn đúng chế độ hỏng đã xảy ra thật hai lần:
 * ai đó gỡ chỗ gọi, mọi cổng vẫn xanh, và tính năng lặng lẽ giao số 0.
 *
 * ⚠ Giới hạn tự khai: đây là phép đo VĂN BẢN. Đổi tên biến trung gian sẽ làm nó
 *   đỏ oan (dễ sửa, và một lần đọc lại chỗ nối không phải là giá đắt); ngược
 *   lại nó KHÔNG bắt được một chỗ nối đúng cú pháp mà sai ngữ nghĩa.
 */

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

const TRANG = doc("src/pages/TwinVanHanh.tsx");
/**
 * ★★★ ĐỢT 28 T-1 — HAI TRUY VẤN WIP ĐÃ DỜI SANG `usePhanTichLine.ts` (tầng 3).
 *
 * Ca "có truy vấn cấp dữ liệu WIP thật" bên dưới ĐỎ ngay lần chạy đầu sau khi
 * tách, và **đó là hành vi đúng của một thiết bị đo tốt**: nó đi tìm chỗ gọi ở
 * `TwinVanHanh.tsx` và không thấy. Nếu nó im lặng xanh thì mới đáng sợ — nghĩa
 * là nó không còn đo gì.
 *
 * ⚠ Cách vá SAI mà không được chọn: xoá ca đó đi. Ca này chặn đúng L-2 (lớp
 *   phủ WIP dựng xong mà nuôi bằng `wip={[]}` — hằng rỗng viết cứng). Nên nó
 *   **đi theo mã**, sang tệp mới, chứ không biến mất.
 */
const PHAN_TICH = doc("src/components/twin3d/van-hanh/usePhanTichLine.ts");
/**
 * ★★★ ĐỢT 28 T-1 TẦNG 2 — BỐN TRUY VẤN TRẠNG THÁI LIVE SANG `useTrangThaiSong.ts`.
 *
 * Ba ca L-1 bên dưới ĐỎ ngay sau khi tách, và một lần nữa **đó là hành vi đúng**:
 * chúng canh trần an toàn bằng cách đếm chuỗi trong `TwinVanHanh.tsx`, nên khi
 * mã dời nhà chúng đi tìm và không thấy. Một bất biến an toàn mà **im lặng
 * xanh** sau khi mất dấu đối tượng nó canh thì nguy hiểm hơn là không có.
 *
 * ⇒ Ba ca ấy nay đọc `SONG` thay vì `TRANG`. Và chúng KHÔNG còn là phép đo duy
 *   nhất: `nhipAnToan.unit.test.ts` đo **GIÁ TRỊ THẬT** của trần (miễn nhiễm
 *   với cả dời nhà lẫn cách viết), còn `useTrangThaiSong.unit.test.ts` neo
 *   từng trần vào từng thủ tục. Ba phép đo, ba điểm mù khác nhau.
 */
const SONG = doc("src/components/twin3d/van-hanh/useTrangThaiSong.ts");
const CANH = doc("src/components/twin3d/van-hanh/CanhVanHanh.tsx");
const DAI = doc("src/components/twin3d/van-hanh/DaiLine.tsx");

describe("★★★ L-1 (#51) — `nhipHoiMs` phải có CHỖ GỌI trong mã sản phẩm", () => {
  it("★★★ trang gọi `nhipHoiMs` theo TÊN HÀM, không chỉ import tệp", () => {
    // Bẫy đã đo: `nguonDuLieu.ts` VỐN ĐÃ được import (cho `xuatXuHienTai`), nên
    // grep theo TÊN TỆP báo "đã nối" trong khi grep theo TÊN HÀM ra 0.
    expect(TRANG).toContain("nhipHoiMs(");
    expect(TRANG).toContain("coLuongTheoKetNoi(");
  });

  it("★★★ KHÔNG còn `refetchInterval` hằng số 30_000/20_000 viết cứng", () => {
    // Ba nhịp ở Đợt 7 là `30_000`, `20_000`, `20_000` viết thẳng vào options.
    expect(SONG).not.toMatch(/refetchInterval:\s*30_000\s*[,}]/);
    expect(SONG).not.toMatch(/refetchInterval:\s*20_000\s*[,}]/);
  });

  it("★★★ cả BA nhịp đều đi qua nhịp thích nghi", () => {
    // ĐỢT 28: bốn truy vấn live nay ở `useTrangThaiSong.ts` (T-1 tầng 2).
    const qua = SONG.match(/refetchInterval:\s*(nhipTongQuanMs|nhipHoiToiDa\()/g) ?? [];
    expect(qua.length).toBeGreaterThanOrEqual(3);
  });

  it("★★★ CẢ HAI truy vấn hạng AN TOÀN giữ trần 20 s — không trôi lên 30 s", () => {
    // Áp thẳng `nhipHoiMs` vào `andon.active`/`anToanRobot` làm chúng CHẬM ĐI
    // khi socket khoẻ: một hồi quy an toàn đội lốt "nối tính năng #51".
    //
    // ★★★ ĐẾM, KHÔNG PHẢI `toContain` — và lý do là một đột biến SỐNG SÓT.
    //   ĐB-9 gỡ trần khỏi `andon.active` (để lại trần ở `anToanRobot`), và bản
    //   `toContain` đầu tiên của test này VẪN XANH: một chuỗi còn sót ở call
    //   site KIA đủ để thoả nó. Đúng lớp lỗi G9 — phép đếm chỉ đúng trong phạm
    //   vi mẫu của nó, và "có ít nhất một" không phải là "cả hai".
    //
    // ★★★ ĐỢT 28 — TRẦN NAY LÀ HẰNG CÓ TÊN (`TRAN_NHIP_AN_TOAN_MS`), nên phép
    //   đếm này neo vào TÊN. Giá trị 20_000 của hằng ấy được canh riêng bằng
    //   `nhipAnToan.unit.test.ts`, đo GIÁ TRỊ THẬT chứ không đo chính tả.
    const soTran = (SONG.match(/nhipHoiToiDa\(coLuongDay, TRAN_NHIP_AN_TOAN_MS\)/g) ?? []).length;
    expect(soTran).toBe(2);

    // Và không call site nào rơi thẳng vào `nhipHoiMs` trong options truy vấn.
    expect(SONG).not.toMatch(/refetchInterval:\s*nhipHoiMs\(/);
  });

  it("★★★ ĐÍCH DANH: `andon.active` VÀ `anToanRobot` mỗi cái mang trần của mình", () => {
    // Đếm tổng vẫn có thể thoả bằng hai trần đặt nhầm chỗ (cả hai ở cùng một
    // truy vấn). Ca này neo từng cái vào ĐÚNG thủ tục của nó.
    for (const [ten, moc] of [
      ["andon.active", "trpc.andon.active.useQuery"],
      ["anToanRobot", "trpc.twinCanh.anToanRobot.useQuery"],
    ] as const) {
      const i = SONG.indexOf(moc);
      expect(i, `${ten}: không tìm thấy chỗ gọi`).toBeGreaterThan(0);
      const khoi = SONG.slice(i, i + 400);
      expect(khoi, `${ten}: mất trần 20 s`).toContain(
        "nhipHoiToiDa(coLuongDay, TRAN_NHIP_AN_TOAN_MS)",
      );
    }
  });

  it("★★★ hook trạng thái phải khai TRƯỚC truy vấn đầu tiên", () => {
    // Lý do CƠ HỌC khiến ba nhịp nằm nguyên dạng hằng suốt hai đợt: `ketNoi`
    // ra đời SAU chỗ khai `refetchInterval`, nên không có đường nào tới đó.
    const viTriHook = TRANG.indexOf("useKhoTrangThai(factoryId");
    const viTriTruyVan = TRANG.indexOf("trpc.twinCanh.danhSachToaNha.useQuery");
    expect(viTriHook).toBeGreaterThan(0);
    expect(viTriTruyVan).toBeGreaterThan(0);
    expect(viTriHook).toBeLessThan(viTriTruyVan);
  });
});

describe("★★★ L-2 (#61/#32/#36) — `wip` và `nhipMs` phải mang dữ liệu THẬT", () => {
  it("★★★ `wip={[]}` — hằng rỗng viết cứng — ĐÃ BIẾN MẤT", () => {
    // Đây là G5 nguyên bản: cổng xanh trên tập rỗng trùng khít cổng xanh của
    // hệ đúng. Dòng này chính là tập rỗng đó.
    expect(TRANG).not.toMatch(/wip=\{\[\]\}/);
  });

  it("★★★ `wip` nhận kết quả của `cotWip`", () => {
    expect(TRANG).toContain("wip={cotWipCanh}");
    expect(TRANG).toContain("cotWip(tinhWip");
  });

  it("★★★ `nhipMs: null` viết cứng ĐÃ BIẾN MẤT — mũi tên biết chạy", () => {
    expect(TRANG).not.toMatch(/nhipMs:\s*null\s*\}/);
    expect(TRANG).toContain("nhipMs: nhipChuyenMs");
    expect(TRANG).toContain("nhipTuCanBang(");
  });

  it("★★★ có truy vấn cấp dữ liệu WIP thật (không phải hằng trong mã)", () => {
    // ĐỢT 28: hai truy vấn này nay ở `usePhanTichLine.ts` (T-1 tầng 3).
    expect(PHAN_TICH).toContain("trpc.digitalTwin.wipFlowState.useQuery");
    expect(PHAN_TICH).toContain("trpc.wip.lineBalance.useQuery");
    // …và trang PHẢI thật sự gọi hook đó, nếu không thì hai truy vấn tồn tại mà
    // không ai chạy — đúng hình dạng G16 mà tệp này sinh ra để chặn.
    expect(TRANG).toContain("usePhanTichLine({");
  });

  it("★ lớp phủ 3D vẫn `return null` khi rỗng — nên tập rỗng THẬT SỰ vẽ số 0", () => {
    // Ghim lại đúng cơ chế khiến L-2 vô hình: nếu dòng này biến mất, khuyết tật
    // sẽ có triệu chứng khác và test trên không còn đo đúng thứ nó nghĩ.
    expect(CANH).toContain("if (wip.length === 0) return null;");
  });
});

describe("★★★ §11.5 — LỚP PHỦ 3D PHẢI CÓ BẢNG XẾP HẠNG 2D SONG SONG", () => {
  it("★★★ `DaiLine` có cột WIP và cột nhịp", () => {
    expect(DAI).toContain("soWip");
    expect(DAI).toContain("nhipChuyenMs");
    expect(DAI).toContain("o-tram-wip-");
    expect(DAI).toContain("dai-line-nhip");
  });

  it("★★★ chỗ gọi `DaiLine` được cấp CẢ WIP LẪN NHỊP", () => {
    // Cột tồn tại trong component mà chỗ gọi không truyền gì vào chính là hình
    // dạng của L-2, chỉ đổi tệp.
    const i = TRANG.indexOf("<DaiLine");
    expect(i).toBeGreaterThan(0);
    const khoi = TRANG.slice(i, i + 2000);
    expect(khoi).toContain("soWip:");
    expect(khoi).toContain("nghen:");
    expect(khoi).toContain("nhipChuyenMs={nhipChuyenMs}");
  });

  it("★★★ HAI bề mặt ăn CÙNG MỘT phép tính — không có bản cài đặt thứ hai (G12)", () => {
    // `cotWip` (3D) và `xepHangWip` (2D) đều gọi `laNghen` bên trong `wipTram.ts`.
    // Nếu trang tự tính lại cờ nghẽn ở đâu đó, hai bề mặt sẽ lệch.
    expect(TRANG).toContain("cotWip(tinhWip, khaiNghen)");
    expect(TRANG).toContain("xepHangWip(tinhWip, khaiNghen)");
    // Trang KHÔNG được tự viết luật nghẽn:
    expect(TRANG).not.toContain("BOI_NGHEN");
    expect(TRANG).not.toMatch(/function\s+laNghen/);
  });

  it("★★★ NGUỒN nút thắt của cả hai bề mặt là MỘT biến duy nhất", () => {
    expect(TRANG).toContain("hang?.bottleneckStationId ?? null");
    // KHÔNG được có nguồn nút thắt thứ hai mang tên khác.
    expect(TRANG).not.toContain("stationLoadHeatmap.useQuery");
  });

  it("★★★ LỜI KHAI NÚT THẮT PHẢI KÈM TUỔI — lỗi bắt bằng mắt ở Đợt 8", () => {
    // Đo trên DB thật: bản ghi `line_balance` của Line 1 đã 16 ngày 18 giờ tuổi
    // và khai trạm 10 (124 WIP) là nút thắt, trong khi trạm 1 giữ 3.152 chiếc.
    // Không kiểm hạn ⇒ màn hình tô đỏ đúng cái trạm KHÔNG hỏng.
    expect(TRANG).toContain("mocKhai");
    expect(TRANG).toContain("periodStart");
    // và tuổi PHẢI đi cùng bản ghi mang giá trị — cùng một `hang`, không ghép
    // từ hai truy vấn (G12).
    const i = TRANG.indexOf("const khaiNghen");
    expect(i).toBeGreaterThan(0);
    const khoi = TRANG.slice(i, i + 700);
    expect(khoi).toContain("canBangQ.data?.[0]");
    expect(khoi).toContain("hang?.periodStart");
    expect(khoi).toContain("hang?.bottleneckStationId");
  });
});

describe("★★★ NT-3 tại chỗ nối — 'chưa đo được' KHÔNG được thành 0", () => {
  it("★★★ `soWip` chỉ là 0 khi truy vấn ĐÃ THÀNH CÔNG", () => {
    // `wipFlowState` chỉ trả trạm CÓ serial. Trạm vắng mặt có hai nghĩa hoàn
    // toàn khác nhau, và quy cả hai về 0 là đúng lớp lỗi CHẶN-2 (in "0 cảnh
    // báo" cho người không có quyền thấy cảnh báo).
    expect(TRANG).toContain("wipQ.isSuccess");
    expect(TRANG).toContain("daDo ? (soTheoTram.get(s.id) ?? 0) : null");
  });

  it("★★★ chỗ gọi `DaiLine` dùng `?? null`, KHÔNG `?? 0`", () => {
    const i = TRANG.indexOf("<DaiLine");
    const khoi = TRANG.slice(i, i + 2000);
    expect(khoi).toContain("soWip: w?.soWip ?? null");
    expect(khoi).not.toContain("soWip: w?.soWip ?? 0");
  });
});
