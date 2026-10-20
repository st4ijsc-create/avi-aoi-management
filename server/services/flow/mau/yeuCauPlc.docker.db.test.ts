/**
 * ★★ Luồng AI Đợt 8.4 — MẪU #3 (spec §5.3): form kỹ sư ⇒ `ai.sinh-ma` (ST, kiểm biên dịch) ⇒ `nguoi.duyet` ⇒ đóng gói tệp +
 * báo cáo kiểm. ĐẦU-CUỐI trên CSDL `_test` với model GIẢ: lần 1 trả ST LỖI CÚ PHÁP, lần 2 trả ST đúng ⇒ RuSTy THẬT (Docker
 * `st-rusty:1.0.7`) bắt lỗi lần 1 (chẩn đoán có dòng gửi lại model), qua lần 2 ⇒ chờ duyệt ⇒ đồng ý ⇒ đóng gói; lượt bị bác
 * ⇒ nhánh bị bác. ×3 lượt (2 đồng ý, 1 bác). Ảnh vắng ⇒ BỎ QUA có thông báo. Không có đường tải xuống thiết bị trong luồng.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { kiemLuong, type FlowDefinition } from "../../../../shared/flow/model";
import { layNut } from "../dangKyNut";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "../dongCo";
import { datHamGoiAi, type HamGoiAi } from "../nut/ai";
import { ANH_ST, coAnhST } from "../lib/bienDichST";

const TT = "t84plc";
const THU_MUC = dirname(fileURLToPath(import.meta.url));
const MAU = JSON.parse(readFileSync(join(THU_MUC, "yeu-cau-plc.json"), "utf8")) as FlowDefinition;
const CO_ANH = await coAnhST().catch(() => false);
if (!CO_ANH) console.warn(`[yeuCauPlc.docker.db.test] BỎ QUA đầu-cuối: ảnh ${ANH_ST} chưa có.`);

const ST_DUNG = `FUNCTION_BLOCK BangTai
VAR_INPUT
  Chay : BOOL;
  DungKhan : BOOL;
  CamBienDay : BOOL;
END_VAR
VAR_OUTPUT
  DongCo : BOOL;
  DenBao : BOOL;
END_VAR
VAR
  treDay : TON;
END_VAR
treDay(IN := CamBienDay, PT := T#3s);
DongCo := Chay AND NOT DungKhan AND NOT treDay.Q;
DenBao := treDay.Q;
END_FUNCTION_BLOCK`;
const ST_LOI = ST_DUNG.replace("DenBao := treDay.Q;", "DenBao := treDay.Q"); // thiếu ';' ở dòng 16

const goiGhi: { vaiTro: string; loai: string; nguoiDung: string }[] = [];
const aiGia: HamGoiAi = async ({ vaiTro, loai, nguoiDung }) => {
  goiGhi.push({ vaiTro, loai, nguoiDung });
  const lanTrongLuot = /KHÔNG biên dịch được/.test(nguoiDung) ? 2 : 1;
  return "Đây là mã:\n```st\n" + (lanTrongLuot === 1 ? ST_LOI : ST_DUNG) + "\n```";
};
let cu: HamGoiAi;
beforeEach(() => {
  cu = datHamGoiAi(aiGia);
  goiGhi.length = 0;
});
afterEach(() => {
  datHamGoiAi(cu);
});
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

async function chayHet() {
  for (let i = 0; i < 100 && (await chayMotMuc("w-plc", undefined, TT)); i++);
}
const db = async () => (await getDb())!;
const layRun = async (id: string) => (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
async function raCua(runId: string, nodeId: string): Promise<Record<string, unknown>[]> {
  const b = (await (await db()).select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, runId))).find((x) => x.nodeId === nodeId && x.status === "xong");
  return ((b?.output as { main?: { json: Record<string, unknown> }[] } | null)?.main ?? []).map((i) => i.json);
}

describe("mẫu #3 PLC — hợp lệ", () => {
  it("kiemLuong sạch, hạng thuan, đúng chuỗi node; KHÔNG node hạng ngoai-ghi/ot nào", () => {
    const kq = kiemLuong(MAU, layNut);
    expect(kq.loi).toEqual([]);
    expect(kq.hang).toBe("thuan");
    expect(MAU.nodes.map((n) => n.type)).toEqual(["kich-hoat.thu-cong", "ai.sinh-ma", "nguoi.duyet", "du-lieu.dat", "du-lieu.dat"]);
    for (const n of MAU.nodes) expect(["thuan", "doc"]).toContain(layNut(n.type)!.tacDungPhu);
  });
});

describe.skipIf(!CO_ANH)("mẫu #3 PLC — đầu-cuối ×3 (RuSTy thật, model giả)", () => {
  it("lần 1 ST lỗi cú pháp ⇒ RuSTy bắt ⇒ lần 2 qua ⇒ duyệt ⇒ đóng gói (2 đồng ý, 1 bác)", async () => {
    const { flowId, version } = await luuPhienBan({ ...MAU, id: `${TT}-mau` }, null);
    for (let lan = 1; lan <= 3; lan++) {
      goiGhi.length = 0;
      const runId = await batDauRun({ flowId, version, items: [{ json: { moTa: `Băng tải ${lan}: chạy khi có lệnh, dừng khẩn, cảm biến đầy quá 3 s thì dừng và bật đèn`, tenKhoi: `BangTai${lan}` } }] });
      await chayHet();
      expect((await layRun(runId)).status).toBe("cho-duyet");
      const [sm] = await raCua(runId, "sinh-ma");
      const bd = sm.bienDich as { ok: boolean; soVong: number; chanDoan: { tep: string; dong: number; mucDo: string }[] };
      expect(sm.ma).toBe(ST_DUNG);
      expect(bd).toMatchObject({ ok: true, soVong: 2 });
      // RuSTy THẬT đã bắt lỗi lần 1 và chẩn đoán có cấu trúc đi vào lời nhắc lần 2
      expect(goiGhi.map((g) => `${g.loai}:${g.vaiTro}`)).toEqual(["sinh-ma:code.plc", "sinh-ma:code.plc"]);
      expect(goiGhi[1].nguoiDung).toMatch(/ma\.st:1[67]:\d+ error/);
      const dongY = lan < 3;
      await traLoiCho({ runId, nodeId: "duyet", cong: dongY ? "dong-y" : "tu-choi", them: { duyet: { dongY, nguoi: 9, lyDo: dongY ? null : "đặt lại thời gian trễ" } } });
      await chayHet();
      expect((await layRun(runId)).status).toBe("xong");
      if (dongY) {
        const [g] = await raCua(runId, "dong-goi");
        expect(g).toMatchObject({
          tep: { ten: `BangTai${lan}.st`, noiDung: ST_DUNG },
          baoCaoKiem: { bienDichOk: true, soVong: 2, soChanDoan: 0 },
          trangThai: "da-duyet-cho-tai-xuong-qua-duong-ky-thuat",
          nguoiDuyet: 9,
        });
        expect(await raCua(runId, "bi-bac")).toEqual([]);
      } else {
        expect((await raCua(runId, "bi-bac"))[0]).toMatchObject({ trangThai: "bi-bac", lyDoBac: "đặt lại thời gian trễ" });
        expect(await raCua(runId, "dong-goi")).toEqual([]);
      }
    }
  }, 120_000);
});
