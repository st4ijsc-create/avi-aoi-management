/**
 * ★ Bầu chủ Luồng AI trên EDGE (AVI_PROCESS_ROLE=edge): edge không có đăng nhập CSDL trung tâm ⇒ KHÔNG mở kết nối, KHÔNG ai là chủ, KHÔNG treo; báo rõ qua bẫy edge.
 * Đột biến: bỏ `edgeDbRefused` khỏi `openSessionClient` ⇒ ca 1 và 2 đỏ (kết nối thật được mở, bầu chủ thắng) và census edgeDbTrap đỏ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { edgeDbTrapStats, EdgeDbTrapError } from "../../db/edgeDbTrap";
import { giuQuyenChu } from "./bauChu";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bauChu trên edge", () => {
  it("★ mặc định: từ chối, la=false, không treo, được đếm theo accessor", async () => {
    vi.stubEnv("AVI_PROCESS_ROLE", "edge");
    vi.stubEnv("EDGE_DB_TRAP", "");
    const truoc = edgeDbTrapStats().byAccessor["openSessionClient:bau-chu"] ?? 0;
    const q = await Promise.race([giuQuyenChu(`edge-${Date.now()}`, "postgres://u:p@127.0.0.1:1/x"), new Promise<never>((_, rj) => setTimeout(() => rj(new Error("treo")), 3000))]);
    expect(q.la).toBe(false);
    await q.nha(); // an toàn
    expect(edgeDbTrapStats().byAccessor["openSessionClient:bau-chu"]).toBe(truoc + 1);
  });

  it("★ EDGE_DB_TRAP=throw: ném EdgeDbTrapError RÕ (không bị nuốt thành la=false)", async () => {
    vi.stubEnv("AVI_PROCESS_ROLE", "edge");
    vi.stubEnv("EDGE_DB_TRAP", "throw");
    await expect(giuQuyenChu(`edge-${Date.now()}`, "postgres://u:p@127.0.0.1:1/x")).rejects.toBeInstanceOf(EdgeDbTrapError);
  });

  it("không phải edge + không có URL ⇒ la=false, không đếm bẫy", async () => {
    vi.stubEnv("AVI_PROCESS_ROLE", "");
    const truoc = edgeDbTrapStats().count;
    const q = await giuQuyenChu("khong-url", "");
    expect(q.la).toBe(false);
    expect(edgeDbTrapStats().count).toBe(truoc);
  });
});
