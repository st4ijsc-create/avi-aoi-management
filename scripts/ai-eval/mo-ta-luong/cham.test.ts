/**
 * ★★ AI Local Đợt 8.4 — KIỂM THƯỚC bộ đo "mô tả → luồng" TRƯỚC khi đo model thật (model GIẢ, không chạm llama-server):
 *   • giả trả luồng ĐÚNG (kèm khoá `activeVersion`/`enabled` cài vào để thử) ⇒ 100 % hợp lệ, 0 tự kích hoạt (khoá bị bỏ);
 *   • giả trả RÁC ⇒ 0 % (và đúng 2 lần gọi mỗi mô tả — hỏi lại một lần);
 *   • giả xen kẽ đúng/rác theo lượt ⇒ hỏi lại cứu được ⇒ 100 %; giả trả luồng SAI kiemLuong (cổng không tồn tại) ⇒ có schema
 *     nhưng 0 % hợp lệ;
 *   • bộ 20 mô tả: đúng 20, id duy nhất, không trùng nội dung.
 * Bản nháp KHÔNG ghi CSDL (taoTuMoTa không chạm CSDL khi không truyền bộ đọc hạng — đếm bằng hàm đếm giả cố định).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { datHamGoiAi, type HamGoiAi } from "../../../server/services/flow/nut/ai";
import { taoTuMoTa } from "../../../server/services/flow/taoTuMoTa";
import { chamBo, coKhoaKichHoat, type MoTa } from "./cham";

const BO = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mo-ta.json"), "utf8")) as { moTa: MoTa[] };

const LUONG_DUNG = (ten: string) => ({
  id: "nhap",
  name: ten.slice(0, 60),
  version: 7,
  activeVersion: 3,
  enabled: true,
  settings: { uuTien: "background", luuDuLieu: "day-du", enabled: true },
  nodes: [
    { id: "t", type: "kich-hoat.thu-cong", typeVersion: 1, name: "Bắt đầu", position: [0, 0], parameters: {} },
    { id: "ai", type: "ai.llm", typeVersion: 1, name: "AI", position: [260, 0], parameters: { vaiTro: "chat", loiNhac: "{{ $json.x }}", truongRa: "traLoi" } },
    { id: "d", type: "nguoi.duyet", typeVersion: 1, name: "Duyệt", position: [520, 0], parameters: { tieuDe: "Duyệt" } },
  ],
  connections: [
    { from: { node: "t", port: "main" }, to: { node: "ai", port: "main" } },
    { from: { node: "ai", port: "main" }, to: { node: "d", port: "main" } },
  ],
});

let cu: HamGoiAi | null = null;
afterEach(() => {
  if (cu) datHamGoiAi(cu);
  cu = null;
});
const dem = async () => ({ tong: 5, bat: 2 });
const moTaCua = (nguoiDung: string) => /<du_lieu>\n([\s\S]*?)\n<\/du_lieu>/.exec(nguoiDung)?.[1] ?? "";

describe("bộ mô tả", () => {
  it("đúng 20 mô tả tiếng Việt, id duy nhất, không trùng", () => {
    expect(BO.moTa).toHaveLength(20);
    expect(new Set(BO.moTa.map((m) => m.id)).size).toBe(20);
    expect(new Set(BO.moTa.map((m) => m.moTa)).size).toBe(20);
    for (const m of BO.moTa) expect(m.moTa.length).toBeGreaterThan(30);
  });
});

describe("kiểm thước (model giả)", () => {
  it("giả ĐÚNG (cài khoá kích hoạt) ⇒ 100 % hợp lệ, 0 tự kích hoạt, bản nháp version 1 không mang khoá kích hoạt", async () => {
    const goi: string[] = [];
    cu = datHamGoiAi(async ({ vaiTro, nguoiDung }) => {
      goi.push(vaiTro);
      return "```json\n" + JSON.stringify(LUONG_DUNG(moTaCua(nguoiDung))) + "\n```";
    });
    const bc = await chamBo(BO.moTa, (m) => taoTuMoTa(m), dem);
    expect(bc).toMatchObject({ tong: 20, hopLe: 20, coSchema: 20, tuKichHoat: 0, tiLeHopLe: 1, datCong: true });
    expect(new Set(goi)).toEqual(new Set(["code.software"]));
    expect(goi).toHaveLength(20);
    const mot = await taoTuMoTa(BO.moTa[0].moTa);
    expect(mot.banNhap?.version).toBe(1);
    expect(coKhoaKichHoat(mot.banNhap)).toBe(false);
    expect(JSON.stringify(mot.banNhap)).not.toMatch(/activeVersion|"enabled"/);
  });

  it("giả RÁC ⇒ 0 %, hỏi lại đúng một lần mỗi mô tả", async () => {
    let n = 0;
    cu = datHamGoiAi(async () => {
      n++;
      return "Xin lỗi, tôi không chắc luồng nên thế nào.";
    });
    const bc = await chamBo(BO.moTa, (m) => taoTuMoTa(m), dem);
    expect(bc).toMatchObject({ hopLe: 0, coSchema: 0, tuKichHoat: 0, tiLeHopLe: 0, datCong: false });
    expect(n).toBe(40);
  });

  it("giả lần 1 rác, lần 2 đúng ⇒ hỏi lại cứu ⇒ 100 % (soLan 2); lời nhắc lần 2 mang lỗi", async () => {
    const nhac: string[] = [];
    cu = datHamGoiAi(async ({ nguoiDung }) => {
      nhac.push(nguoiDung);
      return /KHÔNG hợp lệ/.test(nguoiDung) ? JSON.stringify(LUONG_DUNG("x")) : "{ hỏng";
    });
    const bc = await chamBo(BO.moTa.slice(0, 4), (m) => taoTuMoTa(m));
    expect(bc).toMatchObject({ tong: 4, hopLe: 4 });
    expect(bc.chiTiet.every((c) => c.soLan === 2)).toBe(true);
    expect(nhac[1]).toMatch(/JSON hỏng/);
  });

  it("giả trả luồng SAI kiemLuong (cổng không có) ⇒ có schema nhưng 0 % hợp lệ", async () => {
    cu = datHamGoiAi(async () => {
      const l = LUONG_DUNG("x");
      l.connections[1].from.port = "khong-co";
      return JSON.stringify(l);
    });
    const bc = await chamBo(BO.moTa.slice(0, 3), (m) => taoTuMoTa(m));
    expect(bc).toMatchObject({ tong: 3, hopLe: 0, coSchema: 3 });
    expect(bc.chiTiet[0].loi.join(" ")).toMatch(/không có cổng ra 'khong-co'/);
  });

  it("đếm CSDL đổi giữa lượt ⇒ tính là tự kích hoạt (thước nhạy với ghi lén)", async () => {
    cu = datHamGoiAi(async () => JSON.stringify(LUONG_DUNG("x")));
    let k = 0;
    const bc = await chamBo(BO.moTa.slice(0, 2), (m) => taoTuMoTa(m), async () => ({ tong: 5, bat: 2 + k++ }));
    expect(bc.tuKichHoat).toBe(1);
    expect(bc.datCong).toBe(false);
  });
});
