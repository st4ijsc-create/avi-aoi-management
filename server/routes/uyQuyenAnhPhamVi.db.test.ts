/**
 * ★★★ **UỶ QUYỀN `/uploads/**` THEO ĐƯỜNG DẪN — ÂM ĐỐI XỨNG trên CSDL THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI DỰNG **HAI** NHÀ MÁY, VÀ VÌ SAO MỖI CA CHẶN PHẢI CÓ CA SINH ĐÔI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trên một tập một-nhà-máy, ca *"A không thấy tệp của B"* là **LƯỢNG TỪ TỰ THOẢ** — nó xanh dù
 * cổng có tồn tại hay không (lớp lỗi đã có tên trong sổ tay repo, đã cắn 5 lần trong ngày). Và
 * không có ca sinh đôi ở chiều dương thì một bản vá hỏng kiểu *"chặn tất cả"* cũng xanh ở mọi ca
 * chặn — trong khi 56.527 tệp đang phục vụ thật.
 *
 * ⇒ Mỗi hình dạng có **BỐN** ô: A↛B · B↛A · A→A · B→B.
 *
 * ⚠ Ba hình dạng bắt buộc theo brief (`inspections/` · `aoi/` · `measurement-points/`) đều có đủ
 *   bốn ô. `aoi/` được đo ở **CẢ HAI** khuôn (CŨ 6 đoạn, MỚI 10 đoạn) vì chúng đi hai đường phân
 *   giải hoàn toàn khác nhau (một truy vấn `machines.code` ↔ một phép so tiền tố O(1)).
 *
 * ⚠ DỌN DẸP: `product_inspections` là bảng **WORM** và có FK `ON DELETE RESTRICT` tới `machines`.
 *   Có LỐI DỌN THỨ HAI (xoá mềm cả chuỗi), và mọi phép đếm bám tiền tố `RUN` duy nhất.
 * ⚠ Chạy trên `aoi_management_test` (vitest.setup ép `DATABASE_URL` sang bản `_test`) —
 *   **KHÔNG** để fixture rơi vào `aoi_management` vừa được dọn về đúng 3 nhà máy.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { xoaNhoDemPhamViAnh, type LoiVaoAnh } from "./_congAnh";
import {
  MA_CO_TUYEN_RIENG,
  MA_DUONG_DAN_XAU,
  MA_HINH_DANG_LA,
  MA_KHONG_PHAN_GIAI,
  thongKeNhoDemAnh,
  uyQuyenDuongDanAnh,
  xoaBanDoNhaMayAnh,
  xoaNhoDemUyQuyenAnh,
} from "./_uyQuyenAnh";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `UQA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`;

const FAC_A = `${RUN}-FA`.slice(0, 50);
const FAC_B = `${RUN}-FB`.slice(0, 50);
const SN_A = `${RUN}_SNA`.slice(0, 50);
const SN_B = `${RUN}_SNB`.slice(0, 50);

let sql: ReturnType<typeof postgres>;
type Cay = {
  f: number; w: number; l: number; s: number; m: number; mc: string;
  pm: number; ins: number; mp: number; mpSp: number; pkg: string;
};
let A: Cay;
let B: Cay;
const ids = { uAdmin: 0, uA: 0, uB: 0, uNone: 0 };

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* xem §DỌN DẸP */ }
}

const nguoiDung = (userId: number, userRole = "engineer"): LoiVaoAnh =>
  ({ kieu: "nguoiDung", userId, userRole });

/**
 * ⚠ BA tầng nhớ đệm phải xoá trước mỗi phép đo, không phải hai: `_congAnh` (30 s theo
 * `userId:userRole`), `accessControl.getUserAssignmentCodes` (30 s theo `userId`), và bản đồ
 * nhà máy + nhớ đệm sự kiện của chính module này. Quên một tầng ⇒ ca sau đọc phán quyết của ca
 * trước và lưới "xanh" vì một lý do chẳng liên quan.
 */
async function xoaMoiNhoDem(): Promise<void> {
  xoaNhoDemPhamViAnh();
  xoaNhoDemUyQuyenAnh();
  xoaBanDoNhaMayAnh();
  const { clearAssignmentCache } = await import("../_core/accessControl");
  clearAssignmentCache();
}

/** `true` = được đọc. Gọi qua đúng cửa thật, không qua một đường tắt nào. */
async function duocDoc(lv: LoiVaoAnh, duong: string): Promise<boolean> {
  return (await uyQuyenDuongDanAnh(lv, duong)).ok;
}

async function maTuChoi(lv: LoiVaoAnh, duong: string): Promise<string | null> {
  const kq = await uyQuyenDuongDanAnh(lv, duong);
  return kq.ok ? null : kq.than.code;
}

/** Bốn ô của một hình dạng: A↛B · B↛A · A→A · B→B. */
async function amDoiXung(duongA: string, duongB: string, nhan: string): Promise<void> {
  await xoaMoiNhoDem();
  expect(await duocDoc(nguoiDung(ids.uA), duongB), `${nhan}: A phải KHÔNG đọc được của B`).toBe(false);
  await xoaMoiNhoDem();
  expect(await duocDoc(nguoiDung(ids.uB), duongA), `${nhan}: B phải KHÔNG đọc được của A`).toBe(false);
  await xoaMoiNhoDem();
  expect(await duocDoc(nguoiDung(ids.uA), duongA), `${nhan}: A PHẢI đọc được của chính A`).toBe(true);
  await xoaMoiNhoDem();
  expect(await duocDoc(nguoiDung(ids.uB), duongB), `${nhan}: B PHẢI đọc được của chính B`).toBe(true);
}

describe.skipIf(!DB_URL)("uỷ quyền `/uploads/**` theo đường dẫn — âm ĐỐI XỨNG, CSDL thật", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL as string, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const dungNhaMay = async (n: { fac: string; sn: string }): Promise<Cay> => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${n.fac}, ${n.fac}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f!.id}, ${n.fac + "W"}, ${n.fac + "W"}) RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w!.id}, ${n.fac + "L"}, ${n.fac + "L"}, 100) RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l!.id}, ${n.fac + "S"}, ${n.fac + "S"}) RETURNING id`;
      const mc = `${n.fac}M`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s!.id}, ${mc}, ${mc}, 'AOI') RETURNING id`;
      const [pm] = await sql`INSERT INTO product_models (code, name) VALUES (${n.fac + "PM"}, ${n.fac + "PM"}) RETURNING id`;
      await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId") VALUES (${pm!.id}, ${m!.id})`;
      const [ins] = await sql`
        INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
        VALUES (${m!.id}, ${n.sn}, 'NG', 'NG', NOW() - INTERVAL '1 hour', ${n.fac}) RETURNING id`;
      // Điểm đo GẮN MÁY → trục máy.
      const [mp] = await sql`
        INSERT INTO measurement_point_defs ("productModelId","machineId",code,name,"measurementType","positionX","positionY")
        VALUES (${pm!.id}, ${m!.id}, ${n.fac + "MP"}, ${n.fac + "MP"}, 'VISUAL', 1, 1) RETURNING id`;
      // Điểm đo KHÔNG gắn máy → trục SẢN PHẨM (hợp ba đường). Hai trục, hai ca.
      const [mpSp] = await sql`
        INSERT INTO measurement_point_defs ("productModelId",code,name,"measurementType","positionX","positionY")
        VALUES (${pm!.id}, ${n.fac + "MPS"}, ${n.fac + "MPS"}, 'VISUAL', 2, 2) RETURNING id`;
      const pkg = `${n.fac}-PKG`;
      await sql`INSERT INTO inspection_packages ("machineId","packageId","storageKey","machineCode") VALUES (${m!.id}, ${pkg}, ${`aoi-cache/${pkg}`}, ${mc})`;
      return {
        f: f!.id as number, w: w!.id as number, l: l!.id as number, s: s!.id as number,
        m: m!.id as number, mc, pm: pm!.id as number, ins: ins!.id as number,
        mp: mp!.id as number, mpSp: mpSp!.id as number, pkg,
      };
    };

    A = await dungNhaMay({ fac: FAC_A, sn: SN_A });
    B = await dungNhaMay({ fac: FAC_B, sn: SN_B });

    const mkUser = async (username: string, role: string): Promise<number> => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`uqa-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r!.id as number;
    };
    ids.uAdmin = await mkUser(`uqa-admin-${RUN}`, "admin");
    ids.uA = await mkUser(`uqa-eng-a-${RUN}`, "engineer");
    ids.uB = await mkUser(`uqa-eng-b-${RUN}`, "engineer");
    ids.uNone = await mkUser(`uqa-none-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uA}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uB}, ${FAC_B})`;

    await xoaMoiNhoDem();
  });

  afterAll(async () => {
    try {
      const users = [ids.uAdmin, ids.uA, ids.uB, ids.uNone].filter(Boolean);
      if (users.length) {
        await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
        await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
      }
      for (const c of [A, B]) {
        if (!c) continue;
        await safe(() => sql`DELETE FROM inspection_packages WHERE "packageId" = ${c.pkg}`);
        await safe(() => sql`DELETE FROM measurement_point_defs WHERE id IN (${c.mp}, ${c.mpSp})`);
        await safe(() => sql`DELETE FROM product_inspections WHERE id = ${c.ins}`);
        await safe(() => sql`DELETE FROM product_machine_mappings WHERE "machineId" = ${c.m}`);
        await safe(() => sql`DELETE FROM product_models WHERE id = ${c.pm}`);
        // Lối dọn 1 — xoá mềm (chạy được kể cả khi WORM chặn xoá cứng).
        await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id = ${c.m}`);
        await safe(() => sql`UPDATE stations SET "isActive" = false WHERE id = ${c.s}`);
        await safe(() => sql`UPDATE production_lines SET "isActive" = false WHERE id = ${c.l}`);
        await safe(() => sql`UPDATE workshops SET "isActive" = false WHERE id = ${c.w}`);
        await safe(() => sql`UPDATE factories SET "isActive" = false WHERE id = ${c.f}`);
        // Lối dọn 2 — xoá cứng khi WORM cho phép.
        await safe(() => sql`DELETE FROM machines WHERE id = ${c.m}`);
        await safe(() => sql`DELETE FROM stations WHERE id = ${c.s}`);
        await safe(() => sql`DELETE FROM production_lines WHERE id = ${c.l}`);
        await safe(() => sql`DELETE FROM workshops WHERE id = ${c.w}`);
        await safe(() => sql`DELETE FROM factories WHERE id = ${c.f}`);
      }
    } finally {
      await safe(() => sql.end({ timeout: 5 }));
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §1 — ÂM ĐỐI XỨNG, **NĂM** hình dạng (brief đòi ba)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§1.1 — `inspections/<id>/…` (56.527 tệp, hình dạng đông nhất)", async () => {
    await amDoiXung(
      `/uploads/inspections/${A.ins}/R101-sZyaqbrD.png`,
      `/uploads/inspections/${B.ins}/R101-sZyaqbrD.png`,
      "inspections",
    );
  });

  it("§1.2 — `aoi/<mãMáy>/yyyy/mm/dd/…` — khuôn CŨ 6 đoạn (truy vấn `machines.code`)", async () => {
    await amDoiXung(
      `/uploads/aoi/${A.mc}/2026/08/18/INS-1.zip`,
      `/uploads/aoi/${B.mc}/2026/08/18/INS-1.zip`,
      "aoi (cũ)",
    );
  });

  it("§1.3 — `aoi/<corp>/<nhàMáy>/…` — khuôn MỚI 10 đoạn (so tiền tố O(1), 0 truy vấn/ảnh)", async () => {
    await amDoiXung(
      `/uploads/aoi/_no-corp/${FAC_A}/W/L/M/2026/08/18/INS-1.zip`,
      `/uploads/aoi/_no-corp/${FAC_B}/W/L/M/2026/08/18/INS-1.zip`,
      "aoi (mới)",
    );
  });

  it("§1.4 — `measurement-points/<id>/…` trên CẢ HAI trục (gắn máy · chỉ sản phẩm)", async () => {
    await amDoiXung(
      `/uploads/measurement-points/${A.mp}/crop.png`,
      `/uploads/measurement-points/${B.mp}/crop.png`,
      "measurement-points (trục MÁY)",
    );
    // ⚠ `machineId` NULL ⇒ phải chiếu qua HỢP-BA-ĐƯỜNG của sản phẩm. Bỏ nhánh này ⇒ mọi điểm đo
    //   không gắn máy bị từ chối với CHÍNH CHỦ của nó (vá quá tay), giữ mỗi nhánh này ⇒ điểm đo
    //   gắn máy của nhà máy khác lọt qua. Cần CẢ HAI.
    await amDoiXung(
      `/uploads/measurement-points/${A.mpSp}/crop.png`,
      `/uploads/measurement-points/${B.mpSp}/crop.png`,
      "measurement-points (trục SẢN PHẨM)",
    );
  });

  it("§1.5 — `aoi-cache/<packageId>/…`, `machines/<id>/…`, `product-models/<id>/…`", async () => {
    await amDoiXung(
      `/uploads/aoi-cache/${A.pkg}/R101_check.png`,
      `/uploads/aoi-cache/${B.pkg}/R101_check.png`,
      "aoi-cache",
    );
    await amDoiXung(
      `/uploads/machines/${A.m}/2d-1.jpg`,
      `/uploads/machines/${B.m}/2d-1.jpg`,
      "machines",
    );
    await amDoiXung(
      `/uploads/product-models/${A.pm}/ref-1.png`,
      `/uploads/product-models/${B.pm}/ref-1.png`,
      "product-models",
    );
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §2 — CHIỀU DƯƠNG chống vá quá tay
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§2.1 — nhóm TÁC TẠO vẫn tải được cho MỌI tài khoản, kể cả tài khoản 0 gán nhà máy", async () => {
    for (const u of [ids.uA, ids.uB, ids.uNone]) {
      await xoaMoiNhoDem();
      for (const p of [
        "/uploads/mqtt-releases/10-factory-alert-v1.0.9.apk",
        "/uploads/factory-alert-releases/FactoryAlertSystem-v1.0.0.apk",
        "/uploads/gguf-models/mmproj-model-f16.gguf",
        "/uploads/models/machine-243-1784565729799.glb",
        "/uploads/aoi-test-standalone.html",
      ]) {
        expect(await duocDoc(nguoiDung(u), p), `${u} phải tải được ${p}`).toBe(true);
      }
    }
  });

  it("§2.2 — vé ký · master key · admin: KHÔNG áp cổng nào (kể cả hình dạng LẠ)", async () => {
    // ⚠ Đây là thứ giữ cho ứng dụng di động sống: một vé ký trên `aoi-cache/…` vẫn phục vụ được
    //   **dù** `inspection_packages` của bản triển khai ấy rỗng.
    for (const lv of [{ kieu: "chuKy" } as const, { kieu: "toanCuc" } as const, nguoiDung(ids.uAdmin, "admin")]) {
      await xoaMoiNhoDem();
      expect(await duocDoc(lv, `/uploads/inspections/${B.ins}/x.png`)).toBe(true);
      expect(await duocDoc(lv, "/uploads/aoi-cache/KHONG-TON-TAI/x.png")).toBe(true);
      expect(await duocDoc(lv, "/uploads/thu-muc-la/x.png")).toBe(true);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §3 — FAIL-CLOSED, và mỗi lý do có mã RIÊNG (0 dòng im lặng là nói dối)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§3.1 — hình dạng LẠ ⇒ 403 + `image_path_shape_unknown`, KHÔNG phải 404", async () => {
    await xoaMoiNhoDem();
    const kq = await uyQuyenDuongDanAnh(nguoiDung(ids.uA), "/uploads/thu-muc-chua-ai-khai/x.png");
    expect(kq.ok).toBe(false);
    if (!kq.ok) {
      expect(kq.ma).toBe(403);
      expect(kq.than.code).toBe(MA_HINH_DANG_LA);
      expect(kq.than.scopeApplied).toBe(true);
      expect(kq.than.message).toContain(MA_HINH_DANG_LA);
    }
  });

  it("§3.2 — khoá KHÔNG tra được ⇒ mã RIÊNG `image_path_unresolved` (≠ 'nhà máy khác')", async () => {
    await xoaMoiNhoDem();
    // ⚠ Phân biệt hai lý do là toàn bộ giá trị của ô này: trên CSDL sản xuất hôm nay
    //   **1.996/1.996** hàng `measurement_results` mang ảnh đều mồ côi, nên đây là lý do người
    //   vận hành sẽ gặp NHIỀU NHẤT. Gộp nó vào `image_factory_scope_denied` là bắt họ đi tìm một
    //   lỗi phân quyền không tồn tại.
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/inspections/2147483000/x.png")).toBe(MA_KHONG_PHAN_GIAI);
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/aoi-cache/KHONG-CO-GOI-NAY/x.png")).toBe(MA_KHONG_PHAN_GIAI);
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/aoi/MA-MAY-KHONG-CO/2026/08/18/x.zip")).toBe(MA_KHONG_PHAN_GIAI);
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/aoi/_no-corp/NHA-MAY-KHONG-CO/W/L/M/2026/08/18/x.zip")).toBe(MA_KHONG_PHAN_GIAI);
  });

  it("§3.3 — `report-artifacts/` · `exports/` ⇒ mã RIÊNG (tenant CÓ tuyến uỷ quyền riêng)", async () => {
    await xoaMoiNhoDem();
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/report-artifacts/2026/08/abc.csv")).toBe(MA_CO_TUYEN_RIENG);
    expect(await maTuChoi(nguoiDung(ids.uA), "/uploads/exports/factories_1.xlsx")).toBe(MA_CO_TUYEN_RIENG);
  });

  it("§3.4 — tài khoản 0 gán nhà máy: phạm vi RỖNG, không phải 'không lọc'", async () => {
    await xoaMoiNhoDem();
    expect(await duocDoc(nguoiDung(ids.uNone), `/uploads/inspections/${A.ins}/x.png`)).toBe(false);
    await xoaMoiNhoDem();
    expect(await duocDoc(nguoiDung(ids.uNone), `/uploads/inspections/${B.ins}/x.png`)).toBe(false);
    await xoaMoiNhoDem();
    expect(await duocDoc(nguoiDung(ids.uNone), `/uploads/aoi/_no-corp/${FAC_A}/W/L/M/2026/08/18/x.zip`)).toBe(false);
  });

  it("§3.5 — TRAVERSAL bị chặn cho **MỌI** lối vào, kể cả vé ký và master key", async () => {
    // ⚠ Một `..` không thoát khỏi một nhà máy — nó thoát khỏi cả thư mục gốc. Không có phạm vi nào
    //   để bàn, nên tầng này đứng TRƯỚC phép hỏi phạm vi. Đảo thứ tự = mở lại cửa cho vé/khoá.
    for (const lv of [
      { kieu: "chuKy" } as const,
      { kieu: "toanCuc" } as const,
      nguoiDung(ids.uAdmin, "admin"),
      nguoiDung(ids.uA),
    ]) {
      await xoaMoiNhoDem();
      for (const p of ["/uploads/../.env", "/uploads/%2e%2e%2f.env", "/uploads/C:/Windows/win.ini"]) {
        expect(await maTuChoi(lv, p), `${lv.kieu} · ${p}`).toBe(MA_DUONG_DAN_XAU);
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §4 — CHI PHÍ: nhớ đệm phải làm một màn 20 ảnh tốn ĐÚNG 1 truy vấn
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§4 — NGÂN SÁCH ĐỘ TRỄ mỗi ảnh (hai thước đếm truy vấn đã thử và đều MÙ — xem trong ô)", async () => {
    // ⚠⚠⚠ THƯỚC PHẢI ĐỘC LẬP VỚI THỨ ĐƯỢC ĐO — bài học ĐO ĐƯỢC trong chính lượt này.
    //   Bản đầu của ô này dùng `thongKeNhoDemAnh().truyVan`, tức bộ đếm **bên trong** module. Nó
    //   chỉ đếm những truy vấn module **tự** phát ra, nên nó **MÙ** với lượt
    //   `SELECT id FROM factories WHERE code IN (…)` mà `idsTrongPhamVi("factory")` phát ra ở tầng
    //   dưới cho **MỖI ảnh** của khuôn `aoi/` mới. Ô ấy XANH ở ngưỡng "≤ 1" trong khi chi phí thật
    //   là **3.054 µs/ảnh** — một lượng từ tự thoả, đúng lớp lỗi đã ghi trong sổ tay.
    //   `pg_stat_database.xact_commit` là phép đếm của CHÍNH Postgres ⇒ không mù được.
    // ⚠⚠⚠ **BA THƯỚC ĐÃ THỬ, HAI CÁI MÙ** — ghi lại vì cái mù nào cũng trông y hệt một lượt xanh:
    //   ① `thongKeNhoDemAnh()` (bộ đếm NỘI BỘ) — mù với truy vấn do tầng dưới phát ra, tức mù với
    //      **đúng** con bọ cần bắt.
    //   ② `pg_stat_database.xact_commit` / `pg_stat_user_tables` — MÙ theo **HAI** cách cùng lúc,
    //      và hai cách ấy kéo ngược chiều nhau nên không có ngưỡng nào đứng được:
    //        · Postgres 15+ **hoãn dồn** thống kê của mỗi backend (~1 s) và giữ một ẢNH CHỤP cho
    //          phiên đọc ⇒ **ÂM GIẢ**. Đo tay: với đột biến M6 đang bật, `Δfactories = 0` và
    //          `Δxact = 11` — **y hệt** lúc không có đột biến.
    //        · `xact_commit` đếm **TOÀN CSDL, MỌI kết nối** ⇒ **DƯƠNG GIẢ**. Đo được: ô này ĐỎ với
    //          `Δ = 30` khi chạy cả thư mục `server/routes/` (các tệp lưới khác đang dùng chung
    //          `aoi_management_test`), nhưng XANH khi chạy một mình. Một lưới chỉ đúng lúc chạy
    //          riêng là một lưới sẽ bị tắt đi.
    //   ③ **THỜI GIAN MỖI ẢNH** — thứ duy nhất tách được hai bản: **5,1 µs** (có nhớ đệm) so với
    //      **3.569 µs** (không) trên cùng máy, cùng CSDL. Biên **700×** nên ngưỡng 300 µs nằm giữa
    //      hai bên với hệ số an toàn ~60× ở phía xanh và ~12× ở phía đỏ.
    // ⚠ Đây là một **NGÂN SÁCH ĐỘ TRỄ**, không phải phép đếm truy vấn — nói đúng tên nó ra để
    //   người sau không tưởng nó chứng minh "0 truy vấn".
    const NGAN_SACH_US = 300;

    await xoaMoiNhoDem();
    const lv = nguoiDung(ids.uA);
    await duocDoc(lv, `/uploads/inspections/${A.ins}/anh-0.png`); // làm nóng, không tính
    // Ở đây bộ đếm NỘI BỘ **đủ dùng** và không mù: lượt tra `product_inspections` do CHÍNH module
    // này phát ra. Nó chỉ mù với truy vấn của TẦNG DƯỚI — đúng ca của khuôn `aoi/` phía dưới.
    const q0 = thongKeNhoDemAnh().truyVan;
    const tIns = process.hrtime.bigint();
    for (let i = 1; i < 20; i++) {
      expect(await duocDoc(lv, `/uploads/inspections/${A.ins}/anh-${i}.png`)).toBe(true);
    }
    expect(thongKeNhoDemAnh().truyVan - q0, "19 ảnh CÙNG lần kiểm ⇒ 0 lượt tra thêm").toBe(0);
    expect(Number(process.hrtime.bigint() - tIns) / 1000 / 19).toBeLessThan(NGAN_SACH_US);

    // ★ Khuôn `aoi/` MỚI — ô này ĐÃ BẮT ĐƯỢC một lượt xanh giả: lời khai *"so tiền tố O(1), không
    //   truy vấn"* đúng về HÌNH DẠNG phép so nhưng SAI về CHI PHÍ, vì `idsTrongPhamVi("factory")`
    //   quét `factories` cho **từng ảnh** (3.054 µs/ảnh). 19 ảnh ⇒ tối đa **2** lượt quét
    //   `factories` (một cho bản đồ đoạn→id, một cho phạm vi) — không phải 19.
    await duocDoc(lv, `/uploads/aoi/_no-corp/${FAC_A}/W/L/M/2026/08/18/z-0.zip`); // làm nóng
    const t0 = process.hrtime.bigint();
    const N = 50;
    for (let i = 1; i <= N; i++) {
      expect(await duocDoc(lv, `/uploads/aoi/_no-corp/${FAC_A}/W/L/M/2026/08/18/z-${i}.zip`)).toBe(true);
    }
    const usMoiAnh = Number(process.hrtime.bigint() - t0) / 1000 / N;
    expect(
      usMoiAnh,
      `khuôn \`aoi/\` MỚI phải là O(1) THẬT chứ không chỉ trên giấy — đo được ${usMoiAnh.toFixed(1)} µs/ảnh`,
    ).toBeLessThan(NGAN_SACH_US);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §ĐỘT BIẾN — điều kiện để mọi ca trên có nghĩa
  // ══════════════════════════════════════════════════════════════════════════════════════════
  it("§ĐỘT BIẾN — cổng phạm vi trả `null` (hình dạng lỗi CŨ) ⇒ mọi ca chặn phải SẬP", async () => {
    const hier = await import("../db/hierarchy");
    const thatMachine = hier.machineIdsTrongPhamVi;
    const thatIds = hier.idsTrongPhamVi;
    const s1 = vi.spyOn(hier, "machineIdsTrongPhamVi").mockResolvedValue(null);
    const s2 = vi.spyOn(hier, "idsTrongPhamVi").mockResolvedValue(null);
    try {
      await xoaMoiNhoDem();
      // ⇐ lỗ mở lại ở CẢ NĂM hình dạng
      expect(await duocDoc(nguoiDung(ids.uA), `/uploads/inspections/${B.ins}/x.png`)).toBe(true);
      expect(await duocDoc(nguoiDung(ids.uA), `/uploads/aoi/${B.mc}/2026/08/18/x.zip`)).toBe(true);
      expect(await duocDoc(nguoiDung(ids.uA), `/uploads/aoi/_no-corp/${FAC_B}/W/L/M/2026/08/18/x.zip`)).toBe(true);
      expect(await duocDoc(nguoiDung(ids.uA), `/uploads/measurement-points/${B.mp}/x.png`)).toBe(true);
      expect(await duocDoc(nguoiDung(ids.uNone), `/uploads/machines/${B.m}/x.jpg`)).toBe(true);
    } finally {
      s1.mockRestore();
      s2.mockRestore();
      expect(hier.machineIdsTrongPhamVi).toBe(thatMachine);
      expect(hier.idsTrongPhamVi).toBe(thatIds);
      await xoaMoiNhoDem();
    }

    // …và sau khi gỡ đột biến, cổng phải chặn TRỞ LẠI. Không có phép khẳng định này thì §ĐỘT BIẾN
    // chỉ chứng minh "mock hoạt động", chứ không chứng minh cổng còn sống.
    expect(await duocDoc(nguoiDung(ids.uA), `/uploads/inspections/${B.ins}/x.png`)).toBe(false);
    await xoaMoiNhoDem();
    expect(await duocDoc(nguoiDung(ids.uA), `/uploads/aoi/_no-corp/${FAC_B}/W/L/M/2026/08/18/x.zip`)).toBe(false);
  });
});
