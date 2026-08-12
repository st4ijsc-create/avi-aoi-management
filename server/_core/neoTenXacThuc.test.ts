/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-5 — MỘT CÁI TÊN KHÔNG PHẢI MỘT BẰNG CHỨNG.**
 * (Lưới này đóng nợ Pha 9 nên nó tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts`
 *  kéo nó vào lượng từ *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ file SẢN XUẤT dưới `server/**` gọi một tên phân giải danh tính (`authenticateRequest` ·
 * `xacThucTho` · `verifySession` · `thuXacThucRest`): nó PHẢI **NHẬP** tên ấy từ đúng **CHỦ** của
 * nó (`server/_core/sdk.ts` · `server/routes/_xacThucRest.ts`).***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — MỘT BỀ MẶT HỞ LÀM THIẾT BỊ ĐO **KHOẺ LÊN**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `quetDiemXacThuc` xếp một điểm là *"đi qua ĐIỂM CHUNG"* khi **TÊN** lượt gọi là
 * `authenticateRequest` hoặc `thuXacThucRest`. `uyQuyenRestDiQuaDiemChung()` đọc **một** file
 * (`FILE_UY_QUYEN_REST`) nên nó ghim rằng **bản gốc** uỷ quyền đúng — nó **không** ghim rằng mọi
 * lượt gọi mang tên ấy **là** bản gốc.
 *
 * **ĐO ĐƯỢC** (probe I-5, đã hoàn nguyên) — một hàm **TRÙNG TÊN** tự phân giải danh tính, không
 * kiểm cờ nào:
 *
 *     async function thuXacThucRest(req){ … getSessionByToken … getUserById … }
 *     ⇒ quetDiemXacThuc(…) = [{ loai:"xt", boQua:false, tuCanh:false, tuTraSo:false, tuKiemTaiKhoan:false }]
 *
 * ⇒ Vì `loai === "xt"` và điểm chung đang bật, **cả ba** vị từ phủ (`buocDoiMatKhauMoiBeMat` ·
 *   `thuHoiPhienMoiBeMat` · `taiKhoanBiTatMoiBeMat`) xếp nó là **ĐƯỢC PHỦ**, **và** nó **cộng vào**
 *   cầu chì §3 *"≥ 12 điểm `xt` ⇒ bộ nhận diện còn thấy kho mã"*. Một lỗ làm cầu chì khoẻ lên —
 *   đúng lớp *"an toàn là HỆ QUẢ của thứ khác đang hỏng"*.
 *
 * ⚠⚠ **KHUÔN VÁ ĐÃ CÓ SẴN TRONG REPO, CHO MỘT CÁI TÊN KHÁC.** `totpReplayScan.test.ts:220+`:
 *    ***∀ file gọi `verifyTotpOnce`: nó PHẢI nhập hàm ấy từ chính `_core/totpOnce`*** — nhận diện
 *    module bằng **phép nối đường dẫn** (`phanGiaiToi`, bài học **R1b**), không bằng chính tả
 *    chuỗi, nên `"./sdk"` và `"../_core/sdk"` là **một** module. Ba cái tên xác thực chưa có ô ấy;
 *    file này là ô ấy. **Dùng lại `phanGiaiToi`** — không viết bộ suy thứ N+1.
 *
 * ⚠ VÌ SAO PHÉP NEO **KHÔNG** NẰM TRONG `quetDiemXacThuc()`: ba lưới ∀ hiệu chuẩn vị từ của mình
 *   bằng **mã tổng hợp KHÔNG có lượt nhập nào** (`"tong-hop.ts"`). Bắt bộ nhận diện đòi một lượt
 *   nhập ⇒ mọi ô §1 của **cả ba** lưới thấy `diem.length === 0` ⇒ ba lưới đỏ cùng lúc **vì hạ
 *   tầng**. Xem khối lý lẽ ở `quetDiemXacThuc.ts` §`CHU_CUA_TEN`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Lưới **HÌNH DẠNG**: nó chứng minh cái tên đến từ đúng module, **không** chứng minh thân của
 *     module ấy còn đúng. Thân được canh riêng: `uyQuyenRestDiQuaDiemChung()` (ba lưới ∀) và
 *     `diemChungCuongChe`/`diemChungTraSo`/`diemChungKiemTaiKhoan`.
 *  2. Một lượt tái xuất (`export * from "./sdk"`) ở một file trung gian làm phép nối một nấc không
 *     đủ. Đo được trên `9d81e382`: **0** file `server/**` tái xuất `_core/sdk` hay `_xacThucRest`,
 *     và ô §0c dưới đây **đỏ** nếu chuyện ấy xuất hiện.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moiFileDuoi, laFileTest, phanGiaiToi } from "../routers/deployProcedureScan";
import {
  quetDiemXacThuc,
  neoNhapThieu,
  moiDuongNhap,
  CHU_CUA_TEN,
  TEN_XAC_THUC,
  TEN_UY_QUYEN_REST,
  TEN_TRA_SO_PHIEN,
  TEN_PHEP_CHAN,
  TEN_PHEP_CHAN_PHIEN,
  TEN_PHEP_CHAN_TAI_KHOAN,
  FILE_DIEM_CHUNG,
  FILE_UY_QUYEN_REST,
} from "./quetDiemXacThuc";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts", ".tsx"]).filter((f) => !laFileTest(f.duong));

/** Phép nối đường dẫn của `deployProcedureScan` — **một** bộ suy, dùng lại. */
const neoCua = (f: { duong: string; that: string }) => (spec: string, chu: string) =>
  phanGiaiToi(f.that, spec, join(GOC, chu));

/** Vi phạm thật trên kho mã. */
const VI_PHAM = MOI_FILE_SX.flatMap((f) =>
  neoNhapThieu(f.duong, readFileSync(f.that, "utf8"), neoCua(f)),
);

const nhan = (d: { duong: string; dong: number; ten: string; chu: string }) =>
  `${d.duong}:${d.dong} gọi \`${d.ten}\` mà KHÔNG nhập từ \`${d.chu}\``;

/** Phép neo cho một nguồn TỔNG HỢP đặt tại `server/routes/<ten>` (không cần có trên đĩa). */
const neoGia = (duong: string) => (spec: string, chu: string) =>
  phanGiaiToi(join(GOC, duong), spec, join(GOC, chu));

describe("★★★★ Pha 9 · I-5 — ∀ lượt gọi một tên xác thực: nó phải NHẬP tên ấy từ CHỦ của nó", () => {
  /* ── §0 CẦU CHÌ — một tập rỗng làm mọi khẳng định dưới thành chân lý rỗng ───────────────────── */

  it("§0a lượt quét đĩa KHÔNG rỗng", () => {
    expect(
      MOI_FILE_SX.length,
      "quét `server/**` (không test) ra quá ít file — phạm vi đã hỏng?",
    ).toBeGreaterThanOrEqual(500);
  });

  it("§0b bảng CHỦ đúng SỐ đã ghim, và mỗi chủ TỒN TẠI trên đĩa", () => {
    /**
     * ⚠ Ghim **SỐ**: thêm một cái tên phân giải danh tính là một quyết định an ninh phải nói ra;
     *   bớt một cái tên là một lượt **thu hẹp lượng từ** và cũng phải nói ra.
     * ⚠ Ghim **SỰ TỒN TẠI**: một chủ trỏ vào đường dẫn không có thật làm `phanGiaiToi` **không bao
     *   giờ** khớp ⇒ mọi file gọi tên ấy thành vi phạm ⇒ lưới đỏ vì hạ tầng, không vì kho mã.
     */
    expect([...CHU_CUA_TEN.keys()].sort()).toEqual(
      ["authenticateRequest", "thuXacThucRest", "verifySession", "xacThucTho"].sort(),
    );
    for (const chu of new Set(CHU_CUA_TEN.values())) {
      expect(readFileSync(join(GOC, chu), "utf8").length, `chủ không đọc được: ${chu}`).toBeGreaterThan(100);
    }
  });

  it("§0c KHÔNG file nào TÁI XUẤT một chủ (phép nối MỘT NẤC còn đủ)", () => {
    /**
     * ⚠ `export * from "./sdk"` ở một file trung gian làm `X.authenticateRequest` với tới được mà
     *   **không** nhập trực tiếp chủ ⇒ ô ∀ dưới trở thành một lời hứa hụt. Ô này ghim điều kiện ấy.
     */
    const chuTap = [...new Set(CHU_CUA_TEN.values())];
    const taiXuat: string[] = [];
    for (const f of MOI_FILE_SX) {
      const ma = readFileSync(f.that, "utf8");
      if (!ma.includes("export *")) continue;
      for (const m of ma.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g)) {
        const spec = m[1];
        if (spec !== undefined && chuTap.some((c) => neoCua(f)(spec, c))) taiXuat.push(`${f.duong} → ${spec}`);
      }
    }
    expect(taiXuat.join(" · "), "một chủ bị tái xuất ⇒ phép nối MỘT NẤC không còn đủ").toBe("");
  });

  /* ── §1 HIỆU CHUẨN — ĐÁP SỐ BIẾT TRƯỚC cả hai chiều ────────────────────────────────────────── */

  it("§1a ĐỘT BIẾN TỔNG HỢP — một hàm TRÙNG TÊN, không nhập chủ ⇒ bị BẮT", () => {
    /**
     * ⚠⚠⚠ Đây là **đúng** hình dạng probe I-5 đã dựng: một tuyến REST tự phân giải danh tính, đặt
     * tên hàm giúp việc là `thuXacThucRest`, và được **cả ba** lưới ∀ xếp là ĐƯỢC PHỦ.
     */
    const ma = `
      async function ${TEN_UY_QUYEN_REST}(req: any) {
        const p = await db.${TEN_TRA_SO_PHIEN}(req.headers.cookie);
        return p ? await getUserById(p.userId) : null;
      }
      export async function tuyen(req: any, res: any) {
        const u = await ${TEN_UY_QUYEN_REST}(req);
        if (!u) { res.status(401).json({ error: "x" }); return; }
        res.json({ ok: true });
      }`;
    const duong = "server/routes/__giaTrungTen.ts";

    // Cầu chì: bộ nhận diện VẪN xếp nó là một điểm `xt` "được phủ" — đó chính là cái sai.
    const diem = quetDiemXacThuc(duong, ma).filter((d) => d.loai === "xt");
    expect(diem.length, "cầu chì hỏng: bộ nhận diện không còn thấy lượt gọi trùng tên").toBeGreaterThan(0);
    expect(
      diem.every((d) => !d.boQua && !d.tuCanh && !d.tuTraSo && !d.tuKiemTaiKhoan),
      "cầu chì hỏng: điểm giả không còn có hình dạng 'được phủ mà không kiểm gì'",
    ).toBe(true);

    // Và ĐÂY là ô cưỡng chế: phép neo bắt được nó.
    const vp = neoNhapThieu(duong, ma, neoGia(duong));
    expect(
      vp.map(nhan).join(" · ").length,
      `một hàm TRÙNG TÊN \`${TEN_UY_QUYEN_REST}\` tự phân giải danh tính KHÔNG bị bắt ⇒ phép neo đã chết`,
    ).toBeGreaterThan(0);
    expect(vp.every((d) => d.ten === TEN_UY_QUYEN_REST && d.chu === FILE_UY_QUYEN_REST)).toBe(true);
  });

  it("§1b ĐỘT BIẾN TỔNG HỢP — một đối tượng TRÙNG TÊN `sdk` cục bộ ⇒ bị BẮT", () => {
    const ma = `
      const sdk = { async ${TEN_XAC_THUC}(req: any) { return { id: 1, role: "admin" }; } };
      export async function tuyen(req: any) { return sdk.${TEN_XAC_THUC}(req); }`;
    const duong = "server/routes/__giaSdk.ts";
    const vp = neoNhapThieu(duong, ma, neoGia(duong));
    expect(
      vp.map(nhan).join(" · ").length,
      `một \`sdk\` cục bộ giả làm ĐIỂM CHUNG không bị bắt ⇒ 13 bề mặt được phủ theo LỜI KHAI`,
    ).toBeGreaterThan(0);
    expect(vp.every((d) => d.chu === FILE_DIEM_CHUNG)).toBe(true);
  });

  it("§1c ĐỐI CHỨNG DƯƠNG — nhập ĐÚNG chủ (tĩnh · động · đường khác) ⇒ được THA", () => {
    const duong = "server/routes/__giaThat.ts";
    const kin: readonly [string, string][] = [
      [
        "nhập TĨNH `./_xacThucRest`",
        `import { ${TEN_UY_QUYEN_REST} } from "./_xacThucRest";\nexport async function t(req: any){ return ${TEN_UY_QUYEN_REST}(req); }`,
      ],
      [
        "nhập ĐỘNG `../_core/sdk`",
        `export async function t(req: any){ const { sdk } = await import("../_core/sdk"); return sdk.${TEN_XAC_THUC}(req); }`,
      ],
      [
        "mắt xích NỘI BỘ (`this.`) — không phải một bề mặt",
        `class S { async ${TEN_XAC_THUC}(req: any){ return this.verifySession(req); } }`,
      ],
    ];
    for (const [ten, ma] of kin) {
      expect(
        neoNhapThieu(duong, ma, neoGia(duong)).map(nhan),
        `DƯƠNG TÍNH GIẢ ở "${ten}" — một lưới bắt nhầm là một lưới sẽ bị tắt đi`,
      ).toEqual([]);
    }
  });

  it("§1d phép nối ĐƯỜNG DẪN, không phải chính tả chuỗi (bài học R1b)", () => {
    // Cùng một module, hai cách viết — cả hai phải được tha; một chuỗi *trông giống* thì không.
    const ma = (spec: string) =>
      `import { sdk } from "${spec}";\nexport async function t(req: any){ return sdk.${TEN_XAC_THUC}(req); }`;
    expect(neoNhapThieu("server/routes/x.ts", ma("../_core/sdk"), neoGia("server/routes/x.ts"))).toEqual([]);
    expect(neoNhapThieu("server/_core/y.ts", ma("./sdk"), neoGia("server/_core/y.ts"))).toEqual([]);
    expect(
      neoNhapThieu("server/routes/x.ts", ma("./sdk"), neoGia("server/routes/x.ts")).length,
      "`server/routes/sdk` KHÔNG phải `server/_core/sdk` — phép nhận diện đang so chính tả",
    ).toBeGreaterThan(0);
    expect(
      moiDuongNhap("server/routes/x.ts", ma("../_core/sdk")),
      "bộ đọc lượt nhập mù với `import` tĩnh",
    ).toContain("../_core/sdk");
  });

  it("§1e HÌNH DẠNG THỨ BA được thấy, và ba trục vẫn là BA TRỤC", () => {
    /**
     * ⚠⚠ Hiệu chuẩn nhánh mới của `quetDiemXacThuc` bằng **đáp số biết trước**. Trước lượt vá,
     *    nguồn `tran` dưới đây cho **`[]`** — vô hình với cả ba lượng từ ∀.
     * ⚠ Ba trục **không** gộp: một bề mặt canh đủ ba phải bật đủ ba cờ, canh một trục chỉ bật một.
     */
    const than = (them: string) =>
      `async function f(t){ const p = await db.${TEN_TRA_SO_PHIEN}(t); const u = await getUserById(p.userId); ${them} return u; }`;
    const tran = quetDiemXacThuc("tong-hop.ts", than(""));
    expect(tran.length, "bộ nhận diện MÙ với HÌNH DẠNG THỨ BA").toBe(1);
    expect(tran[0]!.loai, "hình dạng thứ ba phải xếp `phien` — nó vòng qua điểm chung").toBe("phien");
    expect([tran[0]!.tuCanh, tran[0]!.tuTraSo, tran[0]!.tuKiemTaiKhoan]).toEqual([false, false, false]);

    const du = quetDiemXacThuc(
      "tong-hop.ts",
      than(`await ${TEN_PHEP_CHAN}(u); await ${TEN_PHEP_CHAN_PHIEN}(t); await ${TEN_PHEP_CHAN_TAI_KHOAN}(u);`),
    );
    expect([du[0]!.tuCanh, du[0]!.tuTraSo, du[0]!.tuKiemTaiKhoan]).toEqual([true, true, true]);

    // ĐỐI CHỨNG ÂM — một lượt tra sổ phiên **một mình** (đúng `chanNeuPhienDaThuHoi`,
    // `sessionRouter`, `userRouters`) KHÔNG phải một phép phân giải danh tính.
    expect(
      quetDiemXacThuc("tong-hop.ts", `async function f(t){ const h = await db.${TEN_TRA_SO_PHIEN}(t); return h?.isActive === true; }`),
      "DƯƠNG TÍNH GIẢ: một lượt tra sổ KHÔNG kèm lượt lấy hàng `users` bị coi là điểm xác thực",
    ).toEqual([]);
  });

  /* ── §2 LƯỢNG TỪ CHÍNH ─────────────────────────────────────────────────────────────────────── */
  it("★★★★ §2 ∀ file sản xuất `server/**`: mọi tên xác thực đều NHẬP từ CHỦ của nó", () => {
    expect(
      VI_PHAM.map(nhan),
      [
        "Một lượt gọi mang tên một phép phân giải danh tính, nhưng file không nhập tên ấy từ chủ.",
        "⇒ Đó là một hàm/đối tượng TRÙNG TÊN, và cả ba lượng từ ∀ (`buocDoiMatKhauMoiBeMat` ·",
        "  `thuHoiPhienMoiBeMat` · `taiKhoanBiTatMoiBeMat`) sẽ xếp nó là ĐƯỢC PHỦ — theo LỜI KHAI,",
        "  không theo lượt nhập. Tệ hơn: nó CỘNG vào cầu chì §3 (≥12 điểm `xt`).",
        `⇒ Cách đúng: nhập \`${TEN_XAC_THUC}\`/\`${TEN_UY_QUYEN_REST}\` từ \`${FILE_DIEM_CHUNG}\` /`,
        `  \`${FILE_UY_QUYEN_REST}\`; nếu bề mặt CỐ Ý tự phân giải danh tính thì đừng mượn cái tên ấy —`,
        "  đặt tên khác và gọi các phép chặn dùng chung, để ba lưới ∀ nói được sự thật về nó.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("§2b cầu chì cho §2 — lượng từ THẬT SỰ chạm kho mã (có file gọi tên xác thực)", () => {
    /**
     * ⚠ `VI_PHAM` rỗng có **hai** nguyên nhân: kho mã sạch, hoặc bộ dò không thấy lượt gọi nào.
     *   Ô này phân biệt hai nguyên nhân ấy — không có nó, §2 thoả RỖNG mãi mãi.
     */
    const coGoi = MOI_FILE_SX.filter((f) => {
      const ma = readFileSync(f.that, "utf8");
      if (!ma.includes(TEN_XAC_THUC) && !ma.includes(TEN_UY_QUYEN_REST)) return false;
      return quetDiemXacThuc(f.duong, ma).length > 0;
    }).map((f) => f.duong);
    expect(
      coGoi.length,
      "0 file sản xuất gọi một tên xác thực ⇒ §2 là một chân lý rỗng",
    ).toBeGreaterThanOrEqual(8);
  });
});
