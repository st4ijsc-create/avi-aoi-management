/**
 * server/routers/machineTemplateImagePresignCommit.db.test.ts
 *
 * ★★★ Lô 8 Mục 1 (BG-116) — `machineApi.presignTemplateImage` / `.commitTemplateImage`.
 *
 * Gốc: cây dạy Khối B ghi `referenceImageUrl`/`templateImageUrl` = đường dẫn HỆ TỆP MÁY
 * (`D:/InspectProAOI/...jpg`, xem `template-sync-sample.json`) — trình duyệt không fetch
 * được. Cửa này mở đường NHẬN cho máy tải ẢNH THẬT lên hệ, SAU khi cây đã dạy qua
 * `submitMachineTemplate` (không trộn hai cửa — hợp đồng đẩy cây giữ nguyên).
 *
 * ── Đi qua CỬA THẬT (`machineApiRouter.createCaller`), không gọi thẳng `cayDay.ts` ──
 * Cùng bài học Đ-11 mà `cayDayGhiThat.db.test.ts` đã ghi: gọi thẳng hàm chứng minh HÀM
 * chạy, không chứng minh CỬA xác thực/uỷ quyền có thật.
 *
 * ── NĂM MỆNH ĐỀ (brief mục 1.4) ──────────────────────────────────────────────────
 *  1. presign → ghi file thật vào thư mục uploads TEST (LOCAL_STORAGE_DIR) → commit
 *     ⇒ URL vào ĐÚNG hàng (capture VÀ component).
 *  2. Idempotent theo (hàng, sha256): commit LẶP cùng nội dung ⇒ `daDoi:false`, KHÔNG
 *     nhân bản hàng, URL không đổi.
 *  3. Sai máy (capture thuộc máy KHÁC) ⇒ FORBIDDEN, cột không đổi.
 *  4. sha256 khai lệch byte thật ⇒ từ chối, cột không đổi.
 *  5. Chưa xác thực (apiKey sai) ⇒ UNAUTHORIZED, cột không đổi.
 *
 * ── DẤU CHÂN ─────────────────────────────────────────────────────────────────────
 * Bốn bảng cây dạy KHÔNG WORM (đã ghi ở `cayDayGhiThat.db.test.ts`) — dọn THẬT bằng
 * DELETE ở `afterAll`, không `.catch(() => {})` câm.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { machineApiRouter } from "./machineApiRouters";
import { issueMachineKey } from "../services/machineAuthService";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `L8${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { machineA: 0, machineB: 0, product: 0, keyA: 0, keyB: 0 };
let apiKeyA = "";
let apiKeyB = "";
let captureExtId = "";
let componentExtId = "";

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => machineApiRouter.createCaller(ctx());

function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Lô 8 Mục 1 — machineApi.presignTemplateImage / .commitTemplateImage (ghi THẬT, vai avi_app)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string }[]>`
        SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo quyền xanh giả").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[machineTemplateImagePresignCommit] current_database()=${d.db} current_user=${d.usr}`);

      const [mays] = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 2`;
      const machineRows = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 2`;
      if (machineRows.length < 2) {
        throw new Error("machineTemplateImagePresignCommit: cần ÍT NHẤT 2 máy có sẵn trên DB test — chạy scripts/setup-test-db.mjs trước.");
      }
      ids.machineA = machineRows[0].id;
      ids.machineB = machineRows[1].id;

      const [p] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"L8-" + RUN}, 'Lo 8 anh template') RETURNING id`;
      ids.product = p.id;

      const capA = await issueMachineKey({ machineId: ids.machineA, name: `lo8-a-${RUN}`, scopes: ["ingest:write", "equipment:read"] });
      apiKeyA = capA.plaintextKey;
      ids.keyA = capA.id;
      const capB = await issueMachineKey({ machineId: ids.machineB, name: `lo8-b-${RUN}`, scopes: ["ingest:write", "equipment:read"] });
      apiKeyB = capB.plaintextKey;
      ids.keyB = capB.id;

      // Đẩy cây THẬT bằng máy A — lấy captureExtId/componentExtId THẬT từ mẫu máy
      // (không tự bịa GUID — đúng khuôn Khối B).
      const mau = mauThat();
      const ket = await caller().submitMachineTemplate({ apiKey: apiKeyA, productModelCode: `L8-${RUN}`, template: mau });
      expect(ket.success, "đẩy cây nền phải thành công để có hàng thật để commit ảnh vào").toBe(true);
      captureExtId = mau.surfaces[0].positions[0].captures[0].id;
      componentExtId = mau.surfaces[0].positions[0].captures[0].components[0].id;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`; // CASCADE positions/captures
      await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      if (ids.keyA) await sql`DELETE FROM api_keys WHERE id = ${ids.keyA}`;
      if (ids.keyB) await sql`DELETE FROM api_keys WHERE id = ${ids.keyB}`;
      await sql.end();
    }, 60_000);

    beforeEach(() => {
      process.env.STORAGE_MODE = "local";
      process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `l8-tpl-${RUN}-${Math.random().toString(36).slice(2)}`);
      process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
    });
    afterEach(async () => {
      delete process.env.STORAGE_MODE;
      delete process.env.MACHINE_SHARED_KEY_ALLOWED;
      await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
    });

    /** Ghi buffer THẬT vào đúng objectKey mà presign trả về — mô phỏng PUT của máy. */
    async function ghiByteThat(objectKey: string, buf: Buffer): Promise<void> {
      const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, objectKey);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, buf);
    }

    it("MỆNH ĐỀ 1a — capture-level: presign → ghi byte thật → commit ⇒ URL vào product_captures.templateImageUrl", async () => {
      const buf = Buffer.from(`L8-CAP-${RUN}-` + "x".repeat(200));
      const sha = createHash("sha256").update(buf).digest("hex");

      const pre = await caller().presignTemplateImage({
        apiKey: apiKeyA, captureExtId, contentHash: sha, sizeBytes: buf.length, ext: "jpg",
      });
      expect(pre.success).toBe(true);
      expect(pre.cap, "chỉ captureExtId (không componentExtId) ⇒ đích cấp CAPTURE").toBe("capture");

      await ghiByteThat(pre.objectKey, buf);

      const commit = await caller().commitTemplateImage({
        apiKey: apiKeyA, captureExtId, contentHash: sha, ext: "jpg",
      });
      expect(commit.success).toBe(true);
      expect(commit.daDoi, "lượt ghi ĐẦU phải thật sự đổi cột").toBe(true);

      const [row] = await sql<{ url: string | null; key: string | null }[]>`
        SELECT "templateImageUrl" AS url, "templateImageKey" AS key FROM product_captures
         WHERE "captureExtId" = ${captureExtId}`;
      expect(row.url, `[${tenDb}] product_captures.templateImageUrl phải được GHI`).toBe(commit.url);
      expect(row.key).toBe(pre.objectKey);
      expect(row.url, "URL phải trỏ /uploads/... đọc được, KHÔNG phải đường dẫn máy").toMatch(/^\/uploads\//);
    });

    it("MỆNH ĐỀ 1b — component-level: presign+commit với componentExtId ⇒ URL vào measurement_point_defs.referenceImageUrl", async () => {
      const buf = Buffer.from(`L8-COMP-${RUN}-` + "y".repeat(200));
      const sha = createHash("sha256").update(buf).digest("hex");

      const pre = await caller().presignTemplateImage({
        apiKey: apiKeyA, captureExtId, componentExtId, contentHash: sha, sizeBytes: buf.length, ext: "png",
      });
      expect(pre.cap, "captureExtId + componentExtId ⇒ đích cấp COMPONENT").toBe("component");
      await ghiByteThat(pre.objectKey, buf);

      const commit = await caller().commitTemplateImage({
        apiKey: apiKeyA, captureExtId, componentExtId, contentHash: sha, ext: "png",
      });
      expect(commit.success).toBe(true);

      const [row] = await sql<{ url: string | null }[]>`
        SELECT "referenceImageUrl" AS url FROM measurement_point_defs
         WHERE "componentExtId" = ${componentExtId}`;
      expect(row.url, `[${tenDb}] measurement_point_defs.referenceImageUrl phải được GHI`).toBe(commit.url);
    });

    it("MỆNH ĐỀ 2 — idempotent theo (hàng, sha256): commit LẶP cùng nội dung ⇒ daDoi:false, không nhân bản, URL không đổi", async () => {
      const buf = Buffer.from(`L8-IDEMP-${RUN}-` + "z".repeat(200));
      const sha = createHash("sha256").update(buf).digest("hex");

      const pre1 = await caller().presignTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: sha, sizeBytes: buf.length, ext: "jpg" });
      await ghiByteThat(pre1.objectKey, buf);
      const c1 = await caller().commitTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: sha, ext: "jpg" });
      expect(c1.daDoi).toBe(true);

      const [truoc] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM product_captures WHERE "captureExtId" = ${captureExtId}`;
      expect(truoc.n, "trước lượt lặp phải ĐÚNG MỘT hàng capture").toBe(1);

      // Lượt LẶP: presign lại (idempotent ở tầng presign) rồi commit lại CÙNG sha.
      const pre2 = await caller().presignTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: sha, sizeBytes: buf.length, ext: "jpg" });
      expect(pre2.objectKey, "cùng contentHash+ext ⇒ CÙNG objectKey (hàm thuần, không sinh khoá mới)").toBe(pre1.objectKey);
      await ghiByteThat(pre2.objectKey, buf);
      const c2 = await caller().commitTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: sha, ext: "jpg" });
      expect(c2.daDoi, "commit LẶP cùng sha256 ⇒ no-op (key không đổi)").toBe(false);
      expect(c2.url).toBe(c1.url);

      const [sau] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM product_captures WHERE "captureExtId" = ${captureExtId}`;
      expect(sau.n, "KHÔNG được nhân bản hàng capture").toBe(1);
    });

    it("MỆNH ĐỀ 3 — sai máy: capture thuộc máy A, máy B presign/commit ⇒ FORBIDDEN, cột không đổi", async () => {
      const [truoc] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;

      await expect(
        caller().presignTemplateImage({ apiKey: apiKeyB, captureExtId, contentHash: "a".repeat(64), sizeBytes: 10, ext: "jpg" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const buf = Buffer.from(`L8-XMAY-${RUN}`);
      const sha = createHash("sha256").update(buf).digest("hex");
      await expect(
        caller().commitTemplateImage({ apiKey: apiKeyB, captureExtId, contentHash: sha, ext: "jpg" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const [sau] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;
      expect(sau.url, "cột KHÔNG được đổi bởi một máy không sở hữu capture này").toBe(truoc.url);
    });

    it("MỆNH ĐỀ 4 — sha256 khai LỆCH byte thật ⇒ commit từ chối, cột không đổi", async () => {
      const [truoc] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;

      const buf = Buffer.from(`L8-SHALECH-${RUN}-` + "w".repeat(200));
      const shaThat = createHash("sha256").update(buf).digest("hex");
      const shaSai = "b".repeat(64);

      const pre = await caller().presignTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: shaSai, sizeBytes: buf.length, ext: "jpg" });
      await ghiByteThat(pre.objectKey, buf); // byte thật khớp shaThat, KHÔNG khớp shaSai đã khai

      await expect(
        caller().commitTemplateImage({ apiKey: apiKeyA, captureExtId, contentHash: shaSai, ext: "jpg" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const [sau] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;
      expect(sau.url, "sha256 lệch ⇒ KHÔNG được ghi cột").toBe(truoc.url);
      void shaThat; // dùng để tính buf/sha thật — không assert trực tiếp, chỉ đối lập với shaSai
    });

    it("MỆNH ĐỀ 5 — chưa xác thực (apiKey sai) ⇒ UNAUTHORIZED, cột không đổi, KHÔNG hàng nào bị chạm", async () => {
      const [truoc] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;

      await expect(
        caller().presignTemplateImage({ apiKey: "SAI-" + RUN, captureExtId, contentHash: "c".repeat(64), sizeBytes: 10, ext: "jpg" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      await expect(
        caller().commitTemplateImage({ apiKey: "SAI-" + RUN, captureExtId, contentHash: "c".repeat(64), ext: "jpg" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      const [sau] = await sql<{ url: string | null }[]>`SELECT "templateImageUrl" AS url FROM product_captures WHERE "captureExtId" = ${captureExtId}`;
      expect(sau.url).toBe(truoc.url);
    });

    it("MỆNH ĐỀ 6 — captureExtId lạ ⇒ NOT_FOUND (không phải FORBIDDEN — không nhầm 'không tồn tại' với 'khác máy')", async () => {
      await expect(
        caller().presignTemplateImage({ apiKey: apiKeyA, captureExtId: `khong-ton-tai-${RUN}`, contentHash: "d".repeat(64), sizeBytes: 10, ext: "jpg" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("MỆNH ĐỀ 7 — componentExtId sai capture (đúng máy, đúng sản phẩm, KHÁC capture) ⇒ NOT_FOUND", async () => {
      const mau = mauThat();
      const componentCapture2 = mau.surfaces[0].positions[1]?.captures[0]?.components[0]?.id
        ?? mau.surfaces[1]?.positions[0]?.captures[0]?.components[0]?.id;
      expect(componentCapture2, "mẫu máy phải có ÍT NHẤT hai capture để dựng ca này").toBeTruthy();

      await expect(
        caller().presignTemplateImage({
          apiKey: apiKeyA, captureExtId, componentExtId: componentCapture2, contentHash: "e".repeat(64), sizeBytes: 10, ext: "jpg",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  },
);
