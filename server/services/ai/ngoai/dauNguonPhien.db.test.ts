/**
 * ★ Đợt 10.4b L2 (rà kiem-dinh nhóm DB e1–e6) — `xacMinhPhienCoLuotNgoai` TRỰC TIẾP trên CSDL `_test`: mỗi điều kiện của phép xác minh có
 * một ca riêng (id người khác · kết cục ≠ ok · băm lệch · id trỏ hàng ket-qua · tự dò chỉ CHÍNH người · cửa sổ 24 h ở hai biên).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { bamCauTraLoi } from "./soNgoai";
import { xacMinhPhienCoLuotNgoai } from "./dauNguon";
import { LoiNgoai } from "./loi";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const db = async () => (await getDb()) as never;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));

let U = 0;
let V = 0;
/** Một lượt ngoài trong sổ: ý định + kết quả (kết cục / tuổi tuỳ chọn) ⇒ { yDinh, ketQua } id. */
async function luot(userId: number, traLoi: string, o: { ketCuc?: string; tuoi?: string } = {}) {
  const tuoi = o.tuoi ?? "0 seconds";
  const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung", "taoLuc")
    VALUES (1, 'y-dinh', ${userId}, false, 'anthropic', 'claude-x', 'coding', ${"e".repeat(64)}, now() - ${tuoi}::interval) RETURNING id`);
  const [k] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi", "taoLuc")
    VALUES (1, 'ket-qua', ${y!.id}, ${userId}, false, 'anthropic', 'claude-x', 'coding', ${o.ketCuc ?? "ok"}, ${bamCauTraLoi(traLoi)}, now() - ${tuoi}::interval) RETURNING id`);
  return { yDinh: Number(y!.id), ketQua: Number(k!.id) };
}
const lech = async (p: Promise<unknown>) => {
  try {
    await p;
    return "khong-nem";
  } catch (e) {
    return e instanceof LoiNgoai ? `${e.ma}:${e.chiTiet}` : String(e);
  }
};

beforeAll(async () => {
  U = (await taoNguoiDungTest("dnpU", "user")).id;
  V = (await taoNguoiDungTest("dnpV", "user")).id;
});

describe("xacMinhPhienCoLuotNgoai — nhánh có ngoaiCallIds", () => {
  it("id đúng người + ok + băm khớp ⇒ true", async () => {
    const t = `ok ${Date.now()}`;
    const { yDinh } = await luot(U, t);
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [yDinh] })).toBe(true);
  });
  it("e1 — id của NGƯỜI KHÁC (dù băm khớp) ⇒ NGOAI_KHONG_TON_TAI dau-nguon-lech", async () => {
    const t = `cua V ${Date.now()}`;
    const { yDinh } = await luot(V, t);
    expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [yDinh] }))).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
  });
  it("e2 — kết cục ≠ ok (lỗi / bị chặn) dù băm khớp ⇒ lệch", async () => {
    for (const ketCuc of ["loi", "tu-choi", "khong-ro"]) {
      const t = `kc ${ketCuc} ${Date.now()}`;
      const { yDinh } = await luot(U, t, { ketCuc });
      expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [yDinh] })), ketCuc).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
    }
  });
  it("e3 — băm không khớp turn nào ⇒ lệch; MỘT id lệch trong nhiều id ⇒ lệch cả lô", async () => {
    const t = `goc ${Date.now()}`;
    const a = await luot(U, t);
    const b = await luot(U, `khac ${Date.now()}`);
    expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [a.yDinh, b.yDinh] }))).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
  });
  it("e6 — id trỏ HÀNG ket-qua (không phải ý định) / id không tồn tại ⇒ lệch", async () => {
    const t = `kq ${Date.now()}`;
    const { ketQua } = await luot(U, t);
    expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [ketQua] }))).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
    expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t], ngoaiCallIds: [2_000_000_000] }))).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
    // Sổ không có FK `yDinhId` ⇒ một hàng ket-qua CON trỏ vào hàng ket-qua khác là hợp lệ với CSDL: chỉ điều kiện `yd.loai = 'y-dinh'`
    // chặn id của hàng ket-qua cha (bỏ điều kiện đó ⇒ JOIN tìm thấy con ok + băm khớp ⇒ true oan).
    const t2 = `kq long ${Date.now()}`;
    const cha = await luot(U, `cha ${Date.now()}`);
    await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi")
      VALUES (1, 'ket-qua', ${cha.ketQua}, ${U}, false, 'anthropic', 'claude-x', 'coding', 'ok', ${bamCauTraLoi(t2)})`);
    expect(await lech(xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [t2], ngoaiCallIds: [cha.ketQua] }))).toBe("NGOAI_KHONG_TON_TAI:dau-nguon-lech");
  });
});

describe("xacMinhPhienCoLuotNgoai — tự dò (không gửi id)", () => {
  it("e4 — băm thuộc lượt của NGƯỜI KHÁC ⇒ false; của chính mình ⇒ true", async () => {
    const cuaV = `tu do V ${Date.now()}`;
    await luot(V, cuaV);
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [cuaV] })).toBe(false);
    const cuaU = `tu do U ${Date.now()}`;
    await luot(U, cuaU);
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [cuaU] })).toBe(true);
  });
  it("e5 — cửa sổ 24 h ở hai biên: 23 h 59 ⇒ true; 24 h 01 ⇒ false; kết cục lỗi ⇒ false", async () => {
    const trong = `bien trong ${Date.now()}`;
    await luot(U, trong, { tuoi: "23 hours 59 minutes" });
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [trong] })).toBe(true);
    const ngoai = `bien ngoai ${Date.now()}`;
    await luot(U, ngoai, { tuoi: "24 hours 1 minute" });
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [ngoai] })).toBe(false);
    const loi = `tu do loi ${Date.now()}`;
    await luot(U, loi, { ketCuc: "loi" });
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [loi] })).toBe(false);
  });
  it("không có turn trả lời ⇒ false (không truy vấn)", async () => {
    expect(await xacMinhPhienCoLuotNgoai(await db(), { userId: U, traLoi: [] })).toBe(false);
  });
});
