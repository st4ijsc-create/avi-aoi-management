/**
 * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-1** — **PHÉP THU HỒI PHIÊN PHẢI CÓ HIỆU LỰC TRÊN MỌI BỀ MẶT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ điểm xác thực một yêu cầu HTTP/socket trong `server/**` (mã sản xuất): phiên ĐÃ THU HỒI
 * PHẢI bị chặn trên đường ấy.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — CÙNG MỘT ĐIỂM, VÁ MỘT NỬA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 8 Task 2 làm `auth.logout` thu hồi **thật**; cơ chế cưỡng chế **duy nhất** là hàng
 * `user_sessions`, tra ở `sdk.xacThucTho`. Pha 8 Task 1 **tự tay tìm ra** rằng nhánh
 * `Authorization: Bearer` của `validateExternalAuth` (`server/_core/index.ts`) là *"ĐIỂM XÁC THỰC
 * DUY NHẤT VÒNG QUA `authenticateRequest`"* — rồi vá nó **chỉ cho cổng buộc-đổi-mật-khẩu**.
 *
 * ⇒ Phép thu hồi phiên **hở trên 58 tuyến `/api/external/*`**. Đo sống được trước bản vá
 *   (PID 37600, `engineer1` #51): `auth.logout` ⇒ 200 · hàng sổ 290 `isActive=f` · `auth.me` ⇒
 *   `null` · **cùng token** trên `GET /api/external/health` ⇒ **200**; đối chứng âm (không kèm gì)
 *   ⇒ **401**, nên 200 ấy không phải "tuyến vốn công khai".
 *
 * ⇒ Bài học **KHÔNG** phải *"nhớ vá cả hai chỗ"* — mà là *"lượng từ phải theo **ĐƯỜNG THOÁT**, và
 *   MỘT bộ suy phải phục vụ được **cả hai** bất biến"*. Bộ nhận diện điểm xác thực nay có **một
 *   chủ** (`server/_core/quetDiemXacThuc.ts`); file này và `buocDoiMatKhauMoiBeMat.test.ts` gọi
 *   cùng một hàm với hai vị từ khác nhau. Một bề mặt mới ở một **file chưa tồn tại** tự vào **cả
 *   hai** lượng từ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BỐN LỚP CHỐNG "TỰ THOẢ" (mỗi lớp hỏng theo một kiểu khác nhau)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **§1 ĐỐI CHỨNG TỔNG HỢP** — bộ nhận diện chạy trên mã dựng sẵn có **đáp số biết trước**, và
 *     ô hiệu chuẩn khẳng định **ĐÚNG VỊ TỪ §4 dùng** (không phải một vị từ yếu hơn — đó chính là
 *     lỗi I-3 của cùng lượt review).
 *  2. **§2 SÀN SỐ FILE + SÀN SỐ ĐIỂM** — glob rỗng ⇒ vitest im lặng khai XANH (đã sáu lần); thước
 *     còn sống mà mù với kho mã thật thì §3 bắt.
 *  3. **§4 LƯỢNG TỪ CHÍNH** + **§4b ĐIỂM CHUNG thật sự tra sổ**.
 *  4. **§5 HÀNH VI SỐNG trên DB thật** — §4 chỉ trả lời *"mã có HÌNH DẠNG ấy không"*. §5 trả lời
 *     *"một hàng sổ đã lật `isActive` CÓ chặn được không"*, và ghim luôn hai nhánh cho-qua có chủ ý.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI — ĐỪNG ĐỌC MÀU XANH CỦA FILE NÀY THÀNH "ĐÃ PHỦ HẾT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. §4 là lưới **HÌNH DẠNG**. Một `try { await chanNeuPhienDaThuHoi(t) } catch {}` có đúng hình
 *     dạng và vẫn lọt.
 *  2. Nhánh **"không có hàng ⇒ cho qua"** là một lỗ **ĐƯỢC KHAI, CÓ CHỦ Ý** (tương thích ngược với
 *     vé đúc trước khi `user_sessions` ra đời). §5c ghim nó để nó không bị siết **lặng lẽ** — siết
 *     nó là một quyết định vận hành (Pha 7 đã ship một lần ra **nhà tù 4/4 tài khoản**).
 *  3. Xác thực bằng **khoá máy** (`x-master-key`, API key máy/ERP) KHÔNG thuộc lượng từ: chủ thể ở
 *     đó không phải một hàng `users`, không có phiên để thu hồi. Giới hạn **CÓ CHỦ Ý**.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import {
  type DiemXacThuc,
  quetDiemXacThuc,
  diemChungTraSo,
  thanPhuongThucGoi,
  TEN_XAC_THUC,
  TEN_XAC_THUC_THO,
  TEN_PHAN_GIAI_PHIEN,
  TEN_PHEP_CHAN_PHIEN,
  FILE_DIEM_CHUNG,
} from "./quetDiemXacThuc";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "p8c1-thuhoi-mobemat";

/**
 * **TẬP BỀ MẶT TỰ TRA SỔ — GHIM SỐ, NEO HAI CHIỀU.**
 *
 * Mỗi mục là một điểm xác thực được phép **KHÔNG** đi qua điểm chung mà vẫn được coi là phủ, kèm
 * lý do và tên cơ chế canh thay thế. Hôm nay tập này **RỖNG** — mọi điểm hoặc đi qua điểm chung,
 * hoặc **tự** gọi phép chặn. Chốt một con số đang bằng 0 thì rẻ.
 */
const BE_MAT_MIEN_TRU: { duong: string; vi_sao: string; canh_boi: string }[] = [];

const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts", ".tsx"]).filter((f) => !laFileTest(f.duong));
const MOI_DIEM: DiemXacThuc[] = MOI_FILE_SX.flatMap((f) =>
  quetDiemXacThuc(f.duong, readFileSync(f.that, "utf8")),
);
const MA_DIEM_CHUNG = readFileSync(join(GOC, FILE_DIEM_CHUNG), "utf8");
const DIEM_CHUNG_TRA_SO = diemChungTraSo(MA_DIEM_CHUNG);

const laMienTru = (d: DiemXacThuc) => BE_MAT_MIEN_TRU.some((b) => b.duong === d.duong);

/**
 * ★★★★ **VỊ TỪ PHỦ — MỘT CÔNG THỨC, DÙNG CHUNG cho §1 (hiệu chuẩn) và §4 (lượng từ chính).**
 *
 * ⚠⚠ `diemChungTraSo` là **tham số**, không phải hằng đóng gói: §1 phải hiệu chuẩn được vị từ với
 *    điểm chung **giả định BẬT** *và* **giả định TẮT**, và một ô hiệu chuẩn đọc hằng toàn cục sẽ
 *    thoả **bất kể** vị từ phán quyết thế nào — đó đúng là lỗi I-3 mà lượt review này tìm ra ở
 *    lưới Task 1.
 * ⚠ **`boQua` KHÔNG có mặt ở đây**: `boQuaCongDoiMatKhau` chỉ tắt cổng **mật khẩu**; nó không tắt
 *   và không được phép tắt phép tra sổ phiên. (`context.ts` truyền ô ấy — và vẫn tra sổ.)
 */
const phuTheoHinhDang = (d: DiemXacThuc, diemChungBat: boolean): boolean =>
  (d.loai === "xt" && diemChungBat) || d.tuTraSo;
const duocPhu = (d: DiemXacThuc): boolean =>
  phuTheoHinhDang(d, DIEM_CHUNG_TRA_SO) || laMienTru(d);
const nhan = (d: DiemXacThuc) => `${d.duong}:${d.dong} [${d.loai}]`;

describe("★★★★ Review TOÀN NHÁNH Pha 8 C-1 — ∀ điểm xác thực: phiên ĐÃ THU HỒI phải bị chặn", () => {
  /* ── §1 ĐỐI CHỨNG TỔNG HỢP — hiệu chuẩn thước bằng đáp số biết trước ────────────────────────── */

  /** Hình dạng **HỞ**: tự phân giải phiên, KHÔNG tra sổ ⇒ vị từ phải xếp là vi phạm. */
  const MA_HO = [
    [
      "vòng qua điểm chung (đúng hình dạng `validateExternalAuth` trước bản vá)",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); return u; }`,
    ],
    [
      "vòng qua điểm chung + CHỈ kiểm cờ mật khẩu (nửa vá của Task 1)",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); await chanNeuPhaiDoiMatKhau(u); return u; }`,
    ],
  ] as const;

  /** Hình dạng **KÍN**: hoặc tự tra sổ, hoặc đi qua điểm chung. */
  const MA_KIN = [
    [
      "tự tra sổ sau `verifySession`",
      `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); await ${TEN_PHEP_CHAN_PHIEN}(t); return getUserByOpenId(s.openId); }`,
    ],
    [
      "mắt xích NỘI BỘ của điểm chung",
      `class S { async ${TEN_XAC_THUC}(req){ return this.${TEN_PHAN_GIAI_PHIEN}(req); } }`,
    ],
  ] as const;

  it("§1a ĐỘT BIẾN TỔNG HỢP — hình dạng HỞ bị xếp là VI PHẠM (không chỉ 'được nhìn thấy')", () => {
    /**
     * ⚠⚠⚠ Ô này khẳng định **ĐÚNG VỊ TỪ §4 dùng** (`duocPhu`), trên đường dẫn tổng hợp không nằm
     * trong `BE_MAT_MIEN_TRU`. Ép `duocPhu`/`phuTheoHinhDang` thành `true` ⇒ ô này **ĐỎ**. Một ô
     * hiệu chuẩn chỉ hỏi *"bộ dò có THẤY điểm nào không"* sẽ xanh cả khi cổng đã tắt hoàn toàn —
     * đó là lỗi I-3 của chính lượt review này, và nó **không** được lặp lại ở đây.
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
    /**
     * ⚠ Không có ô này, `phuTheoHinhDang` có thể bỏ qua tham số `diemChungBat` mà §1a/§1b vẫn xanh.
     */
    const ma = `async function f(req){ return sdk.${TEN_XAC_THUC}(req); }`;
    const diem = quetDiemXacThuc("tong-hop.ts", ma);
    expect(diem.filter((d) => d.loai === "xt").length, "bộ dò mù với lượt gọi điểm chung").toBe(1);
    expect(diem.every((d) => phuTheoHinhDang(d, true)), "điểm chung BẬT ⇒ phải được phủ").toBe(true);
    expect(diem.some((d) => phuTheoHinhDang(d, false)), "điểm chung TẮT mà vẫn khai PHỦ ⇒ vị từ giả").toBe(false);
  });

  it("§1d thước phân biệt được ĐIỂM CHUNG có tra sổ hay không", () => {
    expect(
      thanPhuongThucGoi(
        `class S { private async ${TEN_XAC_THUC_THO}(req){ const c = 1; await ${TEN_PHEP_CHAN_PHIEN}(c); return c; } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_PHIEN,
      ),
      "bộ nhận diện điểm chung MÙ — nó sẽ khai XANH cả khi phép tra sổ đã bị gỡ",
    ).toBe(true);
    expect(
      thanPhuongThucGoi(
        `class S { private async ${TEN_XAC_THUC_THO}(req){ return req; } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_PHIEN,
      ),
      "bộ nhận diện khai CÓ tra sổ trên một thân KHÔNG hề gọi phép chặn",
    ).toBe(false);
    expect(
      thanPhuongThucGoi(
        `class S { async khac(req){ await ${TEN_PHEP_CHAN_PHIEN}(req); } }`,
        TEN_XAC_THUC_THO,
        TEN_PHEP_CHAN_PHIEN,
      ),
      "phép tra sổ ở một phương thức KHÁC không được tính là điểm chung đã cưỡng chế",
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
    // Đo được 2026-08-10: **12** điểm `xt` + **1** điểm `phien` (`_core/index.ts`, nhánh Bearer).
    expect(
      MOI_DIEM.filter((d) => d.loai === "xt").length,
      "0 điểm `authenticateRequest` trong mã sản xuất — bộ nhận diện đang mù với repo",
    ).toBeGreaterThanOrEqual(12);
    expect(
      MOI_DIEM.filter((d) => d.loai === "phien").length,
      "0 điểm `verifySession` ngoài lớp khai nó — nhánh 'vòng qua điểm chung' của thước đã chết",
    ).toBeGreaterThanOrEqual(1);
  });

  /* ── §4 LƯỢNG TỪ CHÍNH ─────────────────────────────────────────────────────────────────────── */
  it("§4 ∀ điểm xác thực trong mã sản xuất `server/**`: phiên ĐÃ THU HỒI bị chặn", () => {
    const viPham = MOI_DIEM.filter((d) => !duocPhu(d));
    expect(
      viPham.map(nhan),
      [
        "Một bề mặt phân giải danh tính mà KHÔNG tra sổ phiên.",
        "`auth.logout` / `session.revoke` / `revokeAll` KHÔNG có hiệu lực trên bề mặt này — một",
        "cookie bị bắt vẫn đọc và ghi được cho tới `exp` (đo được: 2027).",
        `⇒ Cách đúng: để lượt gọi đi qua ĐIỂM CHUNG \`sdk.${TEN_XAC_THUC}\`,`,
        `  hoặc — nếu bề mặt tự phân giải phiên — gọi \`${TEN_PHEP_CHAN_PHIEN}(token)\` NGAY khi có token.`,
        "  KHÔNG thêm mục vào `BE_MAT_MIEN_TRU` trừ khi có một cơ chế canh THAY THẾ, ghi tên vào `canh_boi`.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("§4b ĐIỂM CHUNG thật sự tra sổ (12/13 điểm được phủ CHỈ nhờ dòng này)", () => {
    expect(
      DIEM_CHUNG_TRA_SO,
      `\`${FILE_DIEM_CHUNG}::${TEN_XAC_THUC_THO}\` không còn gọi \`${TEN_PHEP_CHAN_PHIEN}\` ⇒ MỌI bề mặt hở lại cùng lúc`,
    ).toBe(true);
  });

  it("§4c M3 — một tuyến REST MỚI trong FILE CHƯA TỒN TẠI, không tra sổ ⇒ vẫn bị bắt", () => {
    /**
     * ⚠⚠⚠ Ca phân biệt *"lưới theo ĐƯỜNG THOÁT"* với *"lưới theo FILE"*. `quetDiemXacThuc` nhận
     * một **nguồn bất kỳ**, nên nguồn của một file chưa có trên đĩa vẫn vào được lượng từ.
     */
    const FILE_MOI = "server/routes/tuyenNgoaiMoiN1.ts";
    const ma = `
      import express from "express";
      export function dangKy(app: express.Express): void {
        app.get("/api/external/oee-moi", async (req, res) => {
          const token = (req.header("Authorization") ?? "").slice(7);
          const { sdk } = await import("../_core/sdk");
          const phien = await sdk.${TEN_PHAN_GIAI_PHIEN}(token);
          const { getUserByOpenId } = await import("../db");
          const u = phien ? await getUserByOpenId(phien.openId) : null;
          res.json({ ok: u !== null });
        });
      }`;
    const themVao = quetDiemXacThuc(FILE_MOI, ma);
    expect(themVao.length, "tuyến mới rơi khỏi lượng từ ⇒ bộ suy mù với file mới").toBeGreaterThanOrEqual(1);
    expect(
      themVao.filter((d) => !duocPhu(d)).map(nhan).length,
      "một tuyến REST MỚI tự phân giải phiên mà KHÔNG tra sổ vẫn lọt ⇒ lưới đang canh theo FILE",
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

  /* ── §5 HÀNH VI SỐNG trên DB thật ──────────────────────────────────────────────────────────── */
  describe("§5 hành vi SỐNG của phép chặn trên DB thật", () => {
    let uid = 0;

    beforeAll(async () => {
      uid = (
        await db.createLocalUser({
          username: `${DAU}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
          name: "Review Pha 8 C-1 — thu hồi phiên mọi bề mặt",
          role: "user",
        })
      ).id;
    });

    afterAll(async () => {
      const d = await db.getDb();
      if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
      if (uid) await db.deleteUser(uid);
    });

    /** Dựng một hàng sổ phiên THẬT với token cho trước. */
    async function dungHang(token: string, tuyChon?: { isActive?: boolean; expiresAt?: Date }) {
      const id = await db.createUserSession({
        userId: uid,
        sessionToken: token,
        deviceName: DAU,
        expiresAt: tuyChon?.expiresAt ?? new Date(Date.now() + 3_600_000),
      });
      if (tuyChon?.isActive === false) {
        const d = await db.getDb();
        await d!.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, id));
      }
      return id;
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

    it("§5a CẦU CHÌ (đối chứng DƯƠNG) — hàng SỐNG ⇒ phép chặn IM LẶNG", async () => {
      expect(uid).toBeGreaterThan(0);
      const token = `${DAU}-song-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await dungHang(token);
      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      expect(await loiCua(() => chanNeuPhienDaThuHoi(token))).toBe(null);
    });

    it("★★★ §5b hàng ĐÃ THU HỒI ⇒ phép chặn NÉM", async () => {
      const token = `${DAU}-thuhoi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await dungHang(token, { isActive: false });
      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      const loi = await loiCua(() => chanNeuPhienDaThuHoi(token));
      expect(loi, "hàng sổ ghi `isActive=f` mà phép chặn im lặng ⇒ 58 tuyến REST vẫn mở").not.toBeNull();
      expect(loi).toMatch(/revoked/i);
    });

    it("★★ §5c HÀNG HẾT HẠN ⇒ chặn; và bộ đếm quan sát được NHÍCH đúng một lần", async () => {
      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      const { demChanPhienDaThuHoi, datLaiDemChanPhienDaThuHoi } = await import("./demSoPhien");
      const token = `${DAU}-hethan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await dungHang(token, { expiresAt: new Date(Date.now() - 1_000) });
      datLaiDemChanPhienDaThuHoi();
      expect(await loiCua(() => chanNeuPhienDaThuHoi(token))).not.toBeNull();
      expect(
        demChanPhienDaThuHoi(),
        "phán quyết 'đã thu hồi' KHÔNG để lại dấu vết nào quan sát được ⇒ sản xuất vẫn im lặng",
      ).toBe(1);
    });

    it("🔴 §5d NHÁNH CHO QUA CÓ CHỦ Ý — token KHÔNG có hàng sổ vẫn đi tiếp (tương thích ngược)", async () => {
      /**
       * ⚠⚠⚠ CA NÀY GHIM MỘT LỖ, KHÔNG PHẢI MỘT TÍNH NĂNG. `user_sessions` chỉ được ghi **từ khi cơ
       * chế ra đời**; siết nhánh này thành fail-closed **đá văng mọi vé cũ** — Pha 7 đã deploy đúng
       * lớp ấy ra **nhà tù thật 4/4 tài khoản**. Lối siết đúng (chỉ tha vé có `iat` cũ hơn một mốc
       * cấu hình được) là một **quyết định vận hành của chủ dự án**, không phải một dòng mã.
       * ⇒ Ô này tồn tại để lượt siết ấy **không xảy ra lặng lẽ**: sửa nhánh ⇒ ô này ĐỎ ⇒ có người đọc.
       */
      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      expect(await loiCua(() => chanNeuPhienDaThuHoi(`${DAU}-khong-co-hang-${Date.now()}`))).toBe(null);
      expect(await loiCua(() => chanNeuPhienDaThuHoi(null)), "token rỗng ⇒ không có gì để tra").toBe(null);
      expect(await loiCua(() => chanNeuPhienDaThuHoi(undefined))).toBe(null);
    });
  });
});
