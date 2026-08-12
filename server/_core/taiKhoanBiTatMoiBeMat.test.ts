/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **C-1** — **TÀI KHOẢN BỊ TẮT PHẢI BỊ CHẶN TRÊN MỌI BỀ MẶT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ điểm xác thực một yêu cầu HTTP/socket trong `server/**` (mã sản xuất): một hàng `users` có
 * `isActive = false` PHẢI bị chặn trên đường ấy.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — CƠ CHẾ CÓ TRÊN HAI ĐƯỜNG **HẸP**, VẮNG TRÊN ĐƯỜNG **CHÍNH**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `sdk.xacThucTho` — cửa **duy nhất** cho tRPC, socket, và mọi tuyến REST phiên — hỏi ba câu (*vé
 * ký đúng không* · *hàng sổ phiên còn sống không* · *có bị buộc đổi mật khẩu không*) và **không bao
 * giờ** hỏi *"tài khoản này còn được bật không"*. Cùng lúc đó phép kiểm ấy **đã tồn tại** ở hai chỗ
 * hẹp hơn: `_core/index.ts::validateExternalAuth` (nhánh Bearer) và `authService.ts` (lượt ĐĂNG
 * NHẬP). ⇒ Tài khoản bị tắt **không đăng nhập lại được**, **không vào được `/api/external/*`**,
 * nhưng **cookie đang cầm trên tay dùng được toàn bộ ứng dụng web** tới `ONE_YEAR_MS`.
 *
 * **ĐO ĐƯỢC TRƯỚC BẢN VÁ** (probe hành vi, DB test thật, đi **đường sản phẩm** `db.updateUser`):
 *
 *     ### hàng user_sessions sau lượt tắt: isActive = true
 *     ### KẾT QUẢ SAU KHI TẮT TÀI KHOẢN: ĐI QUA id=2103 role=user isActive=false
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI NỬA, VÀ **KHÔNG NỬA NÀO THAY ĐƯỢC NỬA KIA** (§5 canh nửa đầu, §7 canh nửa sau)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  · **Nửa CƯỠNG CHẾ** — `chanNeuTaiKhoanBiTat` ở lối ra duy nhất của `xacThucTho`. Nó bắt cả lượt
 *    lật cờ bằng **SQL thẳng** (không đi qua hàm sản phẩm nào).
 *  · **Nửa THU HỒI** — `db.updateUser({isActive:false})` gọi `revokeAllSessions`. A2 đã trả **−44%
 *    thông lượng** để mua bất biến *"thu hồi có hiệu lực NGAY"*, nhưng ý định thu hồi phổ biến nhất
 *    của người vận hành — *"tắt tài khoản của người vừa nghỉ việc"* — **không sinh ra một lượt thu
 *    hồi nào**, nên lượt `SELECT` trả tiền cho mỗi request không chạm được nó. §7 làm phép đo ấy
 *    hết đúng, và **đỏ** nếu ai gỡ dòng đó ra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI — ĐỪNG ĐỌC MÀU XANH CỦA FILE NÀY THÀNH "ĐÃ PHỦ HẾT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. §4 là lưới **HÌNH DẠNG**. Một `try { await chanNeuTaiKhoanBiTat(u) } catch {}` vẫn lọt.
 *  2. Hàng đến từ **bộ nhớ đệm phiên** là ảnh chụp tới `AUTH_CACHE_TTL_S` giây. Lượt tắt đi qua
 *     đường sản phẩm **không** có cửa sổ ấy (§7: nó thu hồi phiên ⇒ `chanNeuPhienDaThuHoi`, đứng
 *     TRƯỚC cache, chặn ngay). Cửa sổ chỉ còn cho lượt lật cờ bằng SQL thẳng, và nó **≤ TTL**,
 *     không phải ≤ một năm. Đây là một quyết định, không phải một lượt bỏ sót.
 *  3. Lượt **ĐĂNG NHẬP** (`authService.ts`) giữ phép kiểm riêng: nó ném `LoginError` **và ghi một
 *     hàng kiểm toán** `reason: "account_disabled"` — hai thứ mà một `ForbiddenError` chung không
 *     có. Đó là một bề mặt khác, không phải một bản sao bị bỏ quên.
 *  4. Xác thực bằng **khoá máy** (`x-master-key`, API key máy/ERP) KHÔNG thuộc lượng từ: chủ thể ở
 *     đó không phải một hàng `users`. Giới hạn **CÓ CHỦ Ý**.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * ⚠⚠ **PHẢI ĐẶT TRƯỚC MỌI `import`** — `server/_core/env.ts` đọc `process.env` **đúng một lần** lúc
 * nạp module, và `vitest.setup.ts` cố ý **KHÔNG** nạp `.env`. Thiếu hai biến này thì `signSession`
 * ném và `verifySession` trả `null` ⇒ **ĐỎ VÌ HẠ TẦNG**, một màu đỏ **nói dối** về bất biến đang canh.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "pha9-c1-tai-khoan-bi-tat-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import {
  type DiemXacThuc,
  quetDiemXacThuc,
  diemChungKiemTaiKhoan,
  thanPhuongThucGoi,
  TEN_XAC_THUC,
  TEN_XAC_THUC_THO,
  TEN_PHAN_GIAI_PHIEN,
  TEN_PHEP_CHAN_TAI_KHOAN,
  FILE_DIEM_CHUNG,
  FILE_UY_QUYEN_REST,
  TEN_UY_QUYEN_REST,
  uyQuyenRestDiQuaDiemChung,
} from "./quetDiemXacThuc";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "../../shared/const";
import { clearAuthSessionCache } from "../services/authSessionCache";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "pha9-c1-taikhoan-bitat";
const MOT_GIO_MS = 60 * 60 * 1000;

/**
 * **TẬP BỀ MẶT MIỄN TRỪ — GHIM SỐ, NEO HAI CHIỀU.**
 * Hôm nay **RỖNG**: mọi điểm hoặc đi qua điểm chung, hoặc **tự** gọi phép chặn.
 */
const BE_MAT_MIEN_TRU: { duong: string; vi_sao: string; canh_boi: string }[] = [];

const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts", ".tsx"]).filter((f) => !laFileTest(f.duong));
const MOI_DIEM: DiemXacThuc[] = MOI_FILE_SX.flatMap((f) =>
  quetDiemXacThuc(f.duong, readFileSync(f.that, "utf8")),
);
const MA_DIEM_CHUNG = readFileSync(join(GOC, FILE_DIEM_CHUNG), "utf8");
const DIEM_CHUNG_KIEM = diemChungKiemTaiKhoan(MA_DIEM_CHUNG);

const laMienTru = (d: DiemXacThuc) => BE_MAT_MIEN_TRU.some((b) => b.duong === d.duong);

/**
 * ★★★★ **VỊ TỪ PHỦ — MỘT CÔNG THỨC, DÙNG CHUNG cho §1 (hiệu chuẩn) và §4 (lượng từ chính).**
 *
 * ⚠⚠ `diemChungBat` là **tham số**, không phải hằng đóng gói: §1 phải hiệu chuẩn được vị từ với
 *    điểm chung **giả định BẬT** *và* **giả định TẮT**. Một ô hiệu chuẩn đọc hằng toàn cục sẽ thoả
 *    **bất kể** vị từ phán quyết thế nào.
 * ⚠ **`boQua` KHÔNG có mặt ở đây**: `boQuaCongDoiMatKhau` chỉ tắt cổng **mật khẩu**. Cổng này nằm ở
 *   `xacThucTho`, **dưới** tầm với của ô ấy — và đó là chủ ý: tRPC phải dựng được `ctx.user` cho
 *   người đang bị buộc đổi mật khẩu, nhưng **không** cho người đã bị tắt tài khoản.
 */
const phuTheoHinhDang = (d: DiemXacThuc, diemChungBat: boolean): boolean =>
  (d.loai === "xt" && diemChungBat) || d.tuKiemTaiKhoan;
const duocPhu = (d: DiemXacThuc): boolean => phuTheoHinhDang(d, DIEM_CHUNG_KIEM) || laMienTru(d);
const nhan = (d: DiemXacThuc) => `${d.duong}:${d.dong} [${d.loai}]`;

/** Vị trí mọi lượt gọi `<ten>(…)` **THẬT** (AST) trong một nguồn — bình luận không phải lượt gọi. */
function viTriGoi(ma: string, ten: string): number[] {
  const sf = ts.createSourceFile("x.ts", ma, ts.ScriptTarget.Latest, true);
  const ra: number[] = [];
  const tenCua = (n: ts.CallExpression): string => {
    const e = n.expression;
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return "";
  };
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && tenCua(n) === ten) ra.push(n.getStart(sf));
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

describe("★★★★ Review TOÀN NHÁNH Pha 9 C-1 — ∀ điểm xác thực: tài khoản bị TẮT phải bị chặn", () => {
  /* ── §1 ĐỐI CHỨNG TỔNG HỢP — hiệu chuẩn thước bằng đáp số biết trước ────────────────────────── */

  /** Hình dạng **HỞ**: tự phân giải danh tính, KHÔNG kiểm cờ tài khoản. */
  const MA_HO = [
    [
      "vòng qua điểm chung, không kiểm cờ nào",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); return u; }`,
    ],
    [
      "vòng qua điểm chung + CHỈ tra sổ phiên (nửa vá của Pha 8 C-1)",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); await chanNeuPhienDaThuHoi(t); await chanNeuPhaiDoiMatKhau(u); return u; }`,
    ],
  ] as const;

  /** Hình dạng **KÍN**: hoặc tự kiểm cờ, hoặc đi qua điểm chung. */
  const MA_KIN = [
    [
      "tự kiểm cờ sau khi lấy hàng `users`",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); await ${TEN_PHEP_CHAN_TAI_KHOAN}(u); return u; }`,
    ],
    [
      "mắt xích NỘI BỘ của điểm chung",
      `class S { async ${TEN_XAC_THUC}(req){ return this.${TEN_PHAN_GIAI_PHIEN}(req); } }`,
    ],
  ] as const;

  it("§1a ĐỘT BIẾN TỔNG HỢP — hình dạng HỞ bị xếp là VI PHẠM (không chỉ 'được nhìn thấy')", () => {
    /**
     * ⚠⚠⚠ Ô này khẳng định **ĐÚNG VỊ TỪ §4 dùng** (`duocPhu`). Một ô hiệu chuẩn chỉ hỏi *"bộ dò có
     * THẤY điểm nào không"* sẽ xanh cả khi cổng đã tắt hoàn toàn.
     * ⚠ Mục thứ hai của `MA_HO` là ca quan trọng nhất của cả file: nó có **đủ hai** phép chặn của
     *   hai pha trước và vẫn phải bị xếp là HỞ trên trục này. Ba trục là ba trục.
     */
    for (const [ten, ma] of MA_HO) {
      const diem = quetDiemXacThuc("tong-hop.ts", ma);
      expect(diem.length, `bộ nhận diện MÙ với hình dạng "${ten}"`).toBeGreaterThan(0);
      expect(
        diem.filter((d) => !duocPhu(d)).map(nhan).length,
        `hình dạng "${ten}" KHÔNG bị xếp là HỞ — vị từ phủ đã bị nới, mọi màu xanh dưới là vô nghĩa`,
      ).toBeGreaterThan(0);
    }
  });

  it("§1b ĐỐI CHỨNG DƯƠNG TỔNG HỢP — hình dạng KÍN được THA (không dương tính giả)", () => {
    for (const [ten, ma] of MA_KIN) {
      const ho = quetDiemXacThuc("tong-hop.ts", ma).filter((d) => !phuTheoHinhDang(d, true));
      expect(
        ho.map(nhan),
        `DƯƠNG TÍNH GIẢ ở hình dạng "${ten}" — lưới này sẽ dạy người sau né bằng cách sai`,
      ).toEqual([]);
    }
  });

  it("§1c ĐIỂM CHUNG TẮT ⇒ mọi điểm `xt` trở thành HỞ (vị từ THẬT SỰ phụ thuộc điểm chung)", () => {
    const ma = `async function f(req){ return sdk.${TEN_XAC_THUC}(req); }`;
    const diem = quetDiemXacThuc("tong-hop.ts", ma);
    expect(diem.filter((d) => d.loai === "xt").length, "bộ dò mù với lượt gọi điểm chung").toBe(1);
    expect(diem.every((d) => phuTheoHinhDang(d, true)), "điểm chung BẬT ⇒ phải được phủ").toBe(true);
    expect(
      diem.some((d) => phuTheoHinhDang(d, false)),
      "điểm chung TẮT mà vẫn khai PHỦ ⇒ vị từ giả",
    ).toBe(false);
  });

  it("§1d thước phân biệt được ĐIỂM CHUNG có kiểm cờ tài khoản hay không", () => {
    expect(
      thanPhuongThucGoi(
        `class S { private async ${TEN_XAC_THUC_THO}(req){ const u = 1; await ${TEN_PHEP_CHAN_TAI_KHOAN}(u); return u; } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_TAI_KHOAN,
      ),
      "bộ nhận diện điểm chung MÙ — nó sẽ khai XANH cả khi phép kiểm đã bị gỡ",
    ).toBe(true);
    expect(
      thanPhuongThucGoi(
        `class S { private async ${TEN_XAC_THUC_THO}(req){ return req; } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_TAI_KHOAN,
      ),
      "bộ nhận diện khai CÓ kiểm trên một thân KHÔNG hề gọi phép chặn",
    ).toBe(false);
    expect(
      thanPhuongThucGoi(
        `class S { async ${TEN_XAC_THUC}(req){ await ${TEN_PHEP_CHAN_TAI_KHOAN}(req); } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_TAI_KHOAN,
      ),
      "phép kiểm ở `authenticateRequest` KHÔNG phủ được nhánh tRPC (`boQuaCongDoiMatKhau`) — " +
        "thước phải phân biệt được hai phương thức",
    ).toBe(false);
  });

  /* ── §2/§3 PHẠM VI + LIÊN HỆ KHO MÃ THẬT ───────────────────────────────────────────────────── */
  it("§2 lượt quét đĩa KHÔNG rỗng", () => {
    expect(
      MOI_FILE_SX.length,
      "quét `server/**` (không test) ra quá ít file — phạm vi đã hỏng?",
    ).toBeGreaterThanOrEqual(500);
  });

  it("§3 bộ nhận diện THẤY kho mã thật (đủ cả hai hình dạng)", () => {
    expect(
      MOI_DIEM.filter((d) => d.loai === "xt").length,
      "0 điểm `authenticateRequest` trong mã sản xuất — bộ nhận diện đang mù với repo",
    ).toBeGreaterThanOrEqual(12);
    expect(
      MOI_DIEM.filter((d) => d.loai === "phien").length,
      "0 điểm `verifySession` ngoài lớp khai nó — nhánh 'vòng qua điểm chung' của thước đã chết",
    ).toBeGreaterThanOrEqual(1);
  });

  it("★★ LƯỢT UỶ QUYỀN REST thật sự đi qua ĐIỂM CHUNG (7 bề mặt được phủ nhờ dòng này)", () => {
    expect(
      uyQuyenRestDiQuaDiemChung(readFileSync(join(GOC, FILE_UY_QUYEN_REST), "utf8")),
      `${FILE_UY_QUYEN_REST}::${TEN_UY_QUYEN_REST} không còn gọi ${TEN_XAC_THUC} ⇒ bảy bề mặt REST ` +
        "thôi kiểm cờ tài khoản, mà lượng từ vẫn khai XANH.",
    ).toBe(true);
  });

  /* ── §4 LƯỢNG TỪ CHÍNH ─────────────────────────────────────────────────────────────────────── */
  it("§4 ∀ điểm xác thực trong mã sản xuất `server/**`: tài khoản bị TẮT bị chặn", () => {
    const viPham = MOI_DIEM.filter((d) => !duocPhu(d));
    expect(
      viPham.map(nhan),
      [
        "Một bề mặt phân giải danh tính mà KHÔNG hỏi `users.isActive`.",
        "Lượt tắt tài khoản của quản trị viên KHÔNG có hiệu lực trên bề mặt này — một cookie đang",
        "cầm trên tay giữ nguyên toàn quyền của vai cũ tới `ONE_YEAR_MS` (đo được: tới một năm).",
        `⇒ Cách đúng: để lượt gọi đi qua ĐIỂM CHUNG \`sdk.${TEN_XAC_THUC}\`,`,
        `  hoặc — nếu bề mặt tự phân giải danh tính — gọi \`${TEN_PHEP_CHAN_TAI_KHOAN}(user)\` NGAY khi có hàng.`,
        "  KHÔNG thêm mục vào `BE_MAT_MIEN_TRU` trừ khi có một cơ chế canh THAY THẾ, ghi tên vào `canh_boi`.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("§4b ĐIỂM CHUNG thật sự kiểm cờ (12/13 điểm được phủ CHỈ nhờ dòng này)", () => {
    expect(
      DIEM_CHUNG_KIEM,
      `\`${FILE_DIEM_CHUNG}::${TEN_XAC_THUC_THO}\` không còn gọi \`${TEN_PHEP_CHAN_TAI_KHOAN}\` ⇒ MỌI bề mặt hở lại cùng lúc`,
    ).toBe(true);
  });

  it("★★★★ §4c M3 — một tuyến REST MỚI trong FILE CHƯA TỒN TẠI, không kiểm cờ ⇒ vẫn bị bắt", () => {
    /**
     * ⚠⚠⚠ Ca phân biệt *"lưới theo ĐƯỜNG THOÁT"* với *"lưới theo FILE"*. `quetDiemXacThuc` nhận
     * một **nguồn bất kỳ**, nên nguồn của một file **chưa có trên đĩa** vẫn vào được lượng từ.
     * ⚠ Bề mặt dựng sẵn dưới đây **có** tra sổ phiên và **có** kiểm cờ mật khẩu — nó chỉ thiếu đúng
     *   trục thứ ba. Một lưới gộp ba trục thành một cờ "đã canh" sẽ khai XANH cho nó.
     */
    const FILE_MOI = "server/routes/tuyenNgoaiMoiC1.ts";
    const ma = `
      import express from "express";
      export function dangKy(app: express.Express): void {
        app.get("/api/external/oee-moi-c1", async (req, res) => {
          const token = (req.header("Authorization") ?? "").slice(7);
          const { sdk, chanNeuPhienDaThuHoi, chanNeuPhaiDoiMatKhau } = await import("../_core/sdk");
          const phien = await sdk.${TEN_PHAN_GIAI_PHIEN}(token);
          const { getUserByOpenId } = await import("../db");
          const u = phien ? await getUserByOpenId(phien.openId) : null;
          await chanNeuPhienDaThuHoi(token);
          if (u) await chanNeuPhaiDoiMatKhau(u);
          res.json({ ok: u !== null });
        });
      }`;
    const themVao = quetDiemXacThuc(FILE_MOI, ma);
    expect(themVao.length, "tuyến mới rơi khỏi lượng từ ⇒ bộ suy mù với file mới").toBeGreaterThanOrEqual(1);
    expect(
      themVao.filter((d) => !duocPhu(d)).map(nhan).length,
      "một tuyến REST MỚI tự phân giải danh tính mà KHÔNG kiểm cờ tài khoản vẫn lọt ⇒ lưới đang canh theo FILE",
    ).toBeGreaterThan(0);
  });

  it("§4d tập miễn trừ đúng SỐ đã ghim, và không mục nào là mục MA", () => {
    expect(
      BE_MAT_MIEN_TRU.map((b) => b.duong),
      "tập bề mặt được tha đã đổi — đây là một quyết định an ninh, phải viết ra",
    ).toEqual([]);
    const ma = BE_MAT_MIEN_TRU.filter((b) => !MOI_DIEM.some((d) => d.duong === b.duong));
    expect(ma.map((b) => b.duong), "mục ma vẫn tiếp tục THA cho một điểm mới trùng đường dẫn").toEqual([]);
  });

  /* ── §6 HÌNH DẠNG: MỘT call site, ở LỐI RA DUY NHẤT ────────────────────────────────────────── */
  it("★★★ §6 `chanNeuTaiKhoanBiTat` được gọi ĐÚNG MỘT lần trong `sdk.ts` (AST, không đếm bình luận)", () => {
    /**
     * ⚠⚠ Nhánh trúng cache và nhánh đi DB là **hai** đường ra khỏi `xacThucTho`. Vá bằng cách chép
     *    phép kiểm vào cả hai là dựng hai bản sao dưới một bất biến — đúng lớp lỗi đã đẻ **bốn**
     *    Critical trong chuỗi pha này, và đúng thứ Pha 7 đo được ở chính phương thức này
     *    (*"1/6 lượt rò, 5/6 lượt sạch"*). Bản vá cho hai nhánh **hội** về một biến rồi một lối ra.
     * ⚠ Đếm bằng **AST**: một lượt gọi bị bình luận-hoá đã từng làm §5 của A2 xanh giả.
     */
    expect(
      viTriGoi(MA_DIEM_CHUNG, TEN_PHEP_CHAN_TAI_KHOAN).length,
      "≠1 lượt gọi: 0 ⇒ bản vá C-1 đã bị gỡ; ≥2 ⇒ hai bản sao dưới một bất biến (bản yếu quyết định lưới nào đỏ)",
    ).toBe(1);
  });

  it("★★ §6b CẦU CHÌ cho chính §6 — thước phân biệt được ba tình huống có ĐÁP SỐ BIẾT TRƯỚC", () => {
    const mot = `async function f(u){ await ${TEN_PHEP_CHAN_TAI_KHOAN}(u); return u; }`;
    const hai = `async function f(u,v){ await ${TEN_PHEP_CHAN_TAI_KHOAN}(u); await ${TEN_PHEP_CHAN_TAI_KHOAN}(v); }`;
    const binhLuan = `async function f(u){ // await ${TEN_PHEP_CHAN_TAI_KHOAN}(u);\n return u; }`;
    expect(viTriGoi(mot, TEN_PHEP_CHAN_TAI_KHOAN).length, "thước mù với một lượt gọi THẬT").toBe(1);
    expect(viTriGoi(hai, TEN_PHEP_CHAN_TAI_KHOAN).length, "thước không đếm được bản sao thứ hai").toBe(2);
    expect(
      viTriGoi(binhLuan, TEN_PHEP_CHAN_TAI_KHOAN).length,
      "★ CA ĐÃ LỪA ĐƯỢC MỘT LƯỚI TRƯỚC: lượt gọi bị BÌNH LUẬN-HOÁ vẫn được đếm ⇒ thước đọc chữ, không đọc mã",
    ).toBe(0);
  });

  /* ── §5 + §7 HÀNH VI SỐNG trên DB thật ─────────────────────────────────────────────────────── */
  describe("§5/§7 hành vi SỐNG trên DB thật", () => {
    let uid = 0;
    let openId = "";

    beforeAll(async () => {
      // Cache phải BẬT: §5b nói về đúng nó.
      process.env.AUTH_CACHE_TTL_S = "60";
      const r = await db.createLocalUser({
        username: `${DAU}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
        name: "Review Pha 9 C-1 — tài khoản bị tắt mọi bề mặt",
        role: "user",
      });
      uid = r.id;
      openId = (await db.getUserById(uid))!.openId;
    });

    afterAll(async () => {
      const d = await db.getDb();
      if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
      if (uid) await db.deleteUser(uid);
    });

    function reqVoiCookie(token: string): Parameters<typeof sdk.authenticateRequest>[0] {
      return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as Parameters<
        typeof sdk.authenticateRequest
      >[0];
    }

    /** Dựng một phiên THẬT (JWT ký đúng cửa đúc + hàng `user_sessions` khớp token). */
    async function dungPhien(nhanPhien: string): Promise<string> {
      const token = await sdk.createSessionToken(openId, {
        name: `${DAU}-${nhanPhien}`,
        expiresInMs: MOT_GIO_MS,
      });
      await db.createUserSession({
        userId: uid,
        sessionToken: token,
        deviceName: `${DAU}-${nhanPhien}`,
        expiresAt: new Date(Date.now() + MOT_GIO_MS),
      });
      return token;
    }

    /** Thông điệp lỗi của lượt gọi, hoặc `null` nếu KHÔNG ném. */
    async function loiCua(chay: () => Promise<unknown>): Promise<string | null> {
      try {
        await chay();
        return null;
      } catch (err) {
        return String((err as Error)?.message ?? err);
      }
    }

    /** Bật lại tài khoản + phiên sạch giữa các ô (mỗi ô tự dựng phiên riêng). */
    async function batLai(): Promise<void> {
      const d = await db.getDb();
      await d!.update(userSessions).set({ isActive: true }).where(eq(userSessions.userId, uid));
      await db.updateUser(uid, { isActive: true });
      await clearAuthSessionCache();
    }

    it("§5a CẦU CHÌ (ĐỐI CHỨNG DƯƠNG) — tài khoản còn BẬT ⇒ đi qua, nhiều lượt liên tiếp", async () => {
      /**
       * ⚠⚠ Không có ô này, mọi ô dưới xanh được bằng một bản vá *"chặn tất"* — Pha 7 đã ship một
       *    lượt như thế ra **nhà tù thật 4/4 tài khoản**.
       */
      expect(uid).toBeGreaterThan(0);
      await batLai();
      const token = await dungPhien("doi-chung-duong");
      for (let i = 0; i < 5; i++) {
        const u = await sdk.authenticateRequest(reqVoiCookie(token));
        expect(u.id, `lượt ${i + 1} bị chặn ⇒ bản vá đã dựng một nhà tù`).toBe(uid);
      }
    });

    it("★★★★ §5b ĐƯỜNG SẢN PHẨM — `db.updateUser({isActive:false})` ⇒ lượt kế tiếp BỊ CHẶN", async () => {
      await batLai();
      const token = await dungPhien("duong-san-pham");

      // Cầu chì 1: đi qua khi còn bật (nếu không, ô này chứng minh một tiền đề sai).
      expect((await sdk.authenticateRequest(reqVoiCookie(token))).id).toBe(uid);

      await db.updateUser(uid, { isActive: false });
      // Cầu chì 2: cờ phải THẬT SỰ tắt trong DB.
      expect((await db.getUserById(uid))!.isActive, "cầu chì: cờ chưa tắt ⇒ thí nghiệm chưa xảy ra").toBe(false);

      const loi = await loiCua(() => sdk.authenticateRequest(reqVoiCookie(token)));
      expect(
        loi,
        "tài khoản bị TẮT vẫn xác thực được ⇒ cookie đang cầm trên tay giữ toàn quyền vai cũ tới một năm",
      ).not.toBeNull();
      // ⚠ Có thể chết vì phép thu hồi (§7) HOẶC vì cổng cờ — cả hai đều là fail-closed đúng.
      expect(loi).toMatch(/ACCOUNT_DISABLED|revoked|SESSION_NOT_IN_LEDGER/i);
    });

    it("★★★★ §5c LẬT CỜ BẰNG SQL THẲNG (không qua hàm sản phẩm) ⇒ vẫn BỊ CHẶN", async () => {
      /**
       * ⚠⚠⚠ Ô này là thứ phân biệt **cổng cưỡng chế** với **một lượt dọn dẹp ở đường ghi**. Nếu bản
       *    vá chỉ có nửa `revokeAllSessions` thì ô này **ĐỎ**: hàng sổ phiên không ai lật, cache
       *    không ai dọn, và một lượt lật cờ bằng SQL (đúng thứ một người vận hành làm) vô hiệu.
       */
      await batLai();
      const token = await dungPhien("sql-thang");
      expect((await sdk.authenticateRequest(reqVoiCookie(token))).id).toBe(uid);

      const d = await db.getDb();
      const { users } = await import("../../drizzle/schema");
      await d!.update(users).set({ isActive: false }).where(eq(users.id, uid));
      await clearAuthSessionCache(); // ảnh chụp cache là vùng mù ĐƯỢC KHAI (≤ TTL) — không đo ở đây

      const loi = await loiCua(() => sdk.authenticateRequest(reqVoiCookie(token)));
      expect(loi, "lật cờ bằng SQL thẳng KHÔNG bị chặn ⇒ cổng cưỡng chế không tồn tại").not.toBeNull();
      expect(loi).toMatch(/ACCOUNT_DISABLED/);
    });

    it("★★★ §7 NỬA THU HỒI — lượt TẮT tài khoản sinh ra một lượt thu hồi THẬT trong sổ", async () => {
      /**
       * ⚠⚠⚠ Đây là ô làm phép đo của A2 **hết đúng**. A2 trả −44% thông lượng cho một `SELECT`
       *    `user_sessions` mỗi request, nhưng *"tắt tài khoản"* — ý định thu hồi phổ biến nhất —
       *    **không sinh ra một lượt thu hồi nào** (đo được trước bản vá: hàng sổ vẫn `isActive=t`).
       * ⚠ Ô này đỏ khi ai gỡ `revokeAllSessions` khỏi `db.updateUser`, **kể cả khi** cổng cờ ở
       *   `xacThucTho` vẫn còn — hai nửa, hai ô.
       */
      await batLai();
      const token = await dungPhien("nua-thu-hoi");
      const d = await db.getDb();
      const truoc = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(truoc[0]?.isActive, "cầu chì: hàng sổ phải đang SỐNG trước khi tắt").toBe(true);

      await db.updateUser(uid, { isActive: false });

      const sau = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(
        sau[0]?.isActive,
        "TẮT tài khoản mà hàng sổ phiên vẫn SỐNG ⇒ lượt `SELECT` A2 trả −44% thông lượng để mua " +
          "không chạm được ý định thu hồi phổ biến nhất",
      ).toBe(false);
    });

    it("★★ §7b BẬT LẠI tài khoản KHÔNG được đá ai ra ngoài (đối chứng dương của §7)", async () => {
      /**
       * ⚠ `data.isActive === false` phải **tường minh**: một lượt `updateUser({isActive:true})` hay
       *   một lượt sửa hồ sơ thường (`isActive` là `undefined`) mà thu hồi phiên là dựng một nhà tù
       *   ngược — người dùng bị đá ra mỗi lần quản trị viên sửa số điện thoại của họ.
       */
      await batLai();
      const token = await dungPhien("bat-lai");
      await db.updateUser(uid, { name: "Đổi tên, KHÔNG chạm isActive" });
      const d = await db.getDb();
      const sau = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(
        sau[0]?.isActive,
        "một lượt sửa hồ sơ thường đã thu hồi phiên ⇒ nhà tù ngược",
      ).toBe(true);
      expect((await sdk.authenticateRequest(reqVoiCookie(token))).id).toBe(uid);

      await db.updateUser(uid, { isActive: true });
      const sau2 = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(sau2[0]?.isActive, "lượt BẬT LẠI tài khoản đã thu hồi phiên ⇒ nhà tù ngược").toBe(true);
    });

    it("★★ §5d hàng có `isActive` KHÔNG PHẢI `false` được THA (không dựng nhà tù cho hàng NULL)", async () => {
      /**
       * ⚠ Cột cho phép `NULL`. `!user.isActive` là `true` với `null` ⇒ viết `!` là khoá mọi hàng
       *   chưa đặt cờ ra ngoài. Ô này ghim `=== false` tường minh, trên chính phép chặn dùng chung.
       */
      const { chanNeuTaiKhoanBiTat } = await import("./sdk");
      type HangUser = Parameters<typeof chanNeuTaiKhoanBiTat>[0];
      expect(await loiCua(() => chanNeuTaiKhoanBiTat({ isActive: true } as HangUser))).toBe(null);
      expect(
        await loiCua(() => chanNeuTaiKhoanBiTat({ isActive: null } as unknown as HangUser)),
        "hàng `isActive = NULL` bị chặn ⇒ bản vá đang dùng `!user.isActive`, một nhà tù cho hàng chưa đặt cờ",
      ).toBe(null);
      expect(
        await loiCua(() => chanNeuTaiKhoanBiTat({ isActive: false } as HangUser)),
        "hàng `isActive = false` KHÔNG bị chặn ⇒ phép chặn là mã chết",
      ).not.toBeNull();
    });
  });
});
