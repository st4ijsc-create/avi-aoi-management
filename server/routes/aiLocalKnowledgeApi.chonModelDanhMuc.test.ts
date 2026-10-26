/**
 * Đợt 10.2 bước 5 — `GET /api/ai/chon-model/danh-muc` (cho extension VS Code, không có tRPC): 401 khi không xác thực; có xác thực ⇒ danh mục dựng
 * với NHÀ MÁY CỦA NGƯỜI ĐÃ XÁC THỰC (không từ query); lỗi nội bộ ⇒ 500 không rò chi tiết đường dẫn. Đột biến: bỏ kiểm `xacThuc.ok` ⇒ ca 401 đỏ;
 * đọc nhà máy từ `req.query.factoryId` ⇒ ca "query không đổi phạm vi" đỏ.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  xt: { ok: true, user: { id: 7, role: "user" } } as unknown,
  goiPhamVi: [] as unknown[],
  nhaMay: [3] as number[] | null,
  nem: false,
  goiDanhMuc: [] as unknown[],
}));

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return { ...that, thuXacThucRest: async () => h.xt };
});
vi.mock("../db/reportAggregators", () => ({
  resolveTenantFactoryScope: async (pv: unknown) => {
    h.goiPhamVi.push(pv);
    return { factoryIds: h.nhaMay };
  },
}));
vi.mock("../services/ai/chonModel/danhMuc", () => ({
  layPhuThuocDanhMucMacDinh: async () => ({}),
  layDanhMucModel: async (nm: unknown) => {
    h.goiDanhMuc.push(nm);
    if (h.nem) throw new Error("C:/bi-mat/duong-dan");
    return [{ ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" }];
  },
}));

import { registerAiLocalKnowledgeRoutes } from "./aiLocalKnowledgeApi";

let may: { url: string; server: Server };
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAiLocalKnowledgeRoutes(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  await new Promise<void>((r) => may.server.close(() => r()));
});
const goi = async (q = "") => {
  const r = await fetch(`${may.url}/api/ai/chon-model/danh-muc${q}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
};

describe("GET /api/ai/chon-model/danh-muc", () => {
  it("không xác thực ⇒ 401, KHÔNG gọi danh mục", async () => {
    h.xt = { ok: false, ma: 401, code: "UNAUTHORIZED" };
    h.goiDanhMuc.length = 0;
    const r = await goi();
    expect(r.status).toBe(401);
    expect(r.json.success).toBe(false);
    expect(h.goiDanhMuc).toHaveLength(0);
  });
  it("có xác thực ⇒ danh mục; phạm vi từ NGƯỜI xác thực, nhà máy đầu vào danh mục", async () => {
    h.xt = { ok: true, user: { id: 7, role: "user" } };
    h.goiPhamVi.length = 0;
    h.goiDanhMuc.length = 0;
    const r = await goi();
    expect(r.status).toBe(200);
    expect(r.json.data[0].ma).toBe("auto");
    expect(h.goiPhamVi).toEqual([{ userId: 7, userRole: "user" }]);
    expect(h.goiDanhMuc).toEqual([3]);
  });
  it("query factoryId KHÔNG đổi phạm vi (danh tính chỉ từ phiên)", async () => {
    h.goiPhamVi.length = 0;
    h.goiDanhMuc.length = 0;
    await goi("?factoryId=99&userId=1");
    expect(h.goiPhamVi).toEqual([{ userId: 7, userRole: "user" }]);
    expect(h.goiDanhMuc).toEqual([3]);
  });
  it("admin không gắn nhà máy ⇒ null (không có mục ngoài)", async () => {
    h.nhaMay = null;
    h.goiDanhMuc.length = 0;
    await goi();
    expect(h.goiDanhMuc).toEqual([null]);
    h.nhaMay = [3];
  });
  it("lỗi nội bộ ⇒ 500 success:false", async () => {
    h.nem = true;
    const r = await goi();
    h.nem = false;
    expect(r.status).toBe(500);
    expect(r.json.success).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain("bi-mat");
  });
});
