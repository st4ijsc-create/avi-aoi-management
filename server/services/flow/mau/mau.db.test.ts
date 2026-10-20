/**
 * Đợt 8.1 Task 6 — ba MẪU LUỒNG (spec §5.3 #1, #2, #4) hợp lệ `kiemLuong` và chạy ĐẦU-CUỐI trên CSDL `_test` với hàm gọi
 * AI GIẢ tất định (không chạm llama-server), ×3 lượt liên tiếp mỗi mẫu: kiểm đầu ra từng node cuối + lượt `xong`.
 *   #1 webhook ⇒ ai.llm (chat) ⇒ nguoi.duyet (duyệt bằng `traLoiCho`) ⇒ tạo việc (dong-y) / bị bác (tu-choi)
 *   #2 thủ công ⇒ ai.trich-xuat (lần đầu trả JSON hỏng ⇒ thử lại) ⇒ ai.phan-loai ⇒ đánh dấu chờ duyệt thẻ
 *   #4 lịch 06:00 ⇒ ai.tom-tat ⇒ đóng gói
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { kiemLuong, type FlowDefinition } from "../../../../shared/flow/model";
import { layNut } from "../dangKyNut";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "../dongCo";
import { datHamGoiAi, type HamGoiAi } from "../nut/ai";
import { banLich, kiemThamSoKichHoat } from "../kichHoat/lich";

const TT = "t8mau";
const THU_MUC = dirname(fileURLToPath(import.meta.url));
const docMau = (ten: string) => JSON.parse(readFileSync(join(THU_MUC, ten), "utf8")) as FlowDefinition;
/** Lưu mẫu dưới id có tiền tố riêng của lưới (không giành mục với lưới khác). */
const luuMau = (ten: string, duoi: string) => luuPhienBan({ ...docMau(ten), id: `${TT}-${duoi}` }, null);

const goiGhi: { vaiTro: string; loai: string }[] = [];
let trichLan = 0;
const aiGia: HamGoiAi = async ({ vaiTro, loai, nguoiDung }) => {
  goiGhi.push({ vaiTro, loai });
  if (loai === "llm") return `RCA nháp: ${/lỗi (\S+)/.exec(nguoiDung)?.[1] ?? "?"} — kiểm tra stencil, áp lực dao gạt.`;
  if (loai === "trich-xuat") {
    trichLan++;
    if (trichLan % 2 === 1) return "không phải JSON"; // lần đầu mỗi item sai ⇒ node phải hỏi lại
    return JSON.stringify({ tieuDe: "Quy trình in kem hàn", maTaiLieu: "SOP-SMT-012", phienBan: "C", ngayBanHanh: "2026-09-01", tuKhoa: ["in kem", "stencil"] });
  }
  if (loai === "phan-loai") return "sop";
  if (loai === "tom-tat") return "Ca 3: sản lượng chưa có dữ liệu; không dừng máy nổi bật.";
  return "";
};

let cu: HamGoiAi;
beforeEach(() => {
  cu = datHamGoiAi(aiGia);
  goiGhi.length = 0;
  trichLan = 0;
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
  for (let i = 0; i < 200 && (await chayMotMuc("w-mau", undefined, TT)); i++);
}
const db = async () => (await getDb())!;
const layRun = async (id: string) => (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
async function raCua(runId: string, nodeId: string): Promise<Record<string, unknown>[]> {
  const b = (await (await db()).select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, runId))).find((x) => x.nodeId === nodeId && x.status === "xong");
  return ((b?.output as { main?: { json: Record<string, unknown> }[] } | null)?.main ?? []).map((i) => i.json);
}

describe("mẫu luồng — hợp lệ", () => {
  it("mọi tệp mẫu qua kiemLuong + kiểm tham số kích hoạt, hạng `thuan`", () => {
    const tep = readdirSync(THU_MUC).filter((f) => f.endsWith(".json"));
    expect(tep.sort()).toEqual(["aoi-loi-lap-rca.json", "bao-cao-ca.json", "tai-lieu-sieu-du-lieu.json", "yeu-cau-plc.json"]); // Đợt 8.4: +#3 PLC (đầu-cuối ở yeuCauPlc.docker.db.test.ts)
    for (const f of tep) {
      const kq = kiemLuong(docMau(f), layNut);
      expect(kq.loi, f).toEqual([]);
      expect(kq.hang, f).toBe("thuan");
      expect(kiemThamSoKichHoat(docMau(f)), f).toEqual([]);
    }
  });
});

describe("mẫu luồng — đầu-cuối ×3 (AI giả tất định, DB)", () => {
  it("#1 AOI lỗi lặp ⇒ RCA nháp ⇒ duyệt trưởng ca ⇒ tạo việc (×3; lượt 3 bị bác)", async () => {
    const { flowId, version } = await luuMau("aoi-loi-lap-rca.json", "aoi");
    for (let lan = 1; lan <= 3; lan++) {
      const runId = await batDauRun({ flowId, version, nutKichHoat: "su-kien", triggerKind: "webhook", items: [{ json: { may: `AOI-${lan}`, maLoi: "BRIDGE", soLan: 7, sanPham: "PCB-A" } }] });
      await chayHet();
      expect((await layRun(runId)).status).toBe("cho-duyet");
      const dongY = lan < 3;
      expect(await traLoiCho({ runId, nodeId: "duyet", cong: dongY ? "dong-y" : "tu-choi", them: { duyet: { dongY, nguoi: 7, lyDo: dongY ? null : "thiếu dữ liệu" } } })).toEqual({ ok: true, cong: dongY ? "dong-y" : "tu-choi" });
      await chayHet();
      expect((await layRun(runId)).status).toBe("xong");
      if (dongY) {
        const [v] = await raCua(runId, "tao-viec");
        expect(v.viec).toEqual({ loai: "rca-aoi", tieuDe: `Xử lý lỗi BRIDGE trên AOI-${lan}`, moTa: "RCA nháp: BRIDGE — kiểm tra stencil, áp lực dao gạt.", trangThai: "can-xu-ly", nguoiDuyet: 7 });
        expect(await raCua(runId, "bi-bac")).toEqual([]);
      } else {
        const [v] = await raCua(runId, "bi-bac");
        expect(v).toMatchObject({ ketQua: "bi-bac", lyDoBac: "thiếu dữ liệu" });
        expect(await raCua(runId, "tao-viec")).toEqual([]);
      }
    }
    expect(goiGhi.filter((g) => g.loai === "llm").map((g) => g.vaiTro)).toEqual(["chat", "chat", "chat"]);
  });

  it("#2 Tài liệu ⇒ trích siêu dữ liệu (thử lại khi JSON hỏng) ⇒ phân loại (×3)", async () => {
    const { flowId, version } = await luuMau("tai-lieu-sieu-du-lieu.json", "tl");
    for (let lan = 1; lan <= 3; lan++) {
      const runId = await batDauRun({ flowId, version, items: [{ json: { tenTep: `sop-${lan}.pdf`, vanBan: "SOP-SMT-012 Quy trình in kem hàn, phiên bản C ..." } }] });
      await chayHet();
      expect((await layRun(runId)).status).toBe("xong");
      const [v] = await raCua(runId, "cho-duyet-the");
      expect(v).toMatchObject({
        tenTep: `sop-${lan}.pdf`,
        loaiTaiLieu: "sop",
        trangThaiThe: "cho-duyet",
        sieuDuLieu: { tieuDe: "Quy trình in kem hàn", maTaiLieu: "SOP-SMT-012", phienBan: "C", ngayBanHanh: "2026-09-01", tuKhoa: ["in kem", "stencil"] },
      });
    }
    expect(goiGhi.filter((g) => g.loai === "trich-xuat")).toHaveLength(6); // 3 lượt × (sai + hỏi lại)
    expect(new Set(goiGhi.map((g) => `${g.loai}:${g.vaiTro}`))).toEqual(new Set(["trich-xuat:extract", "phan-loai:classify"]));
  });

  it("#4 Báo cáo ca: lịch 06:00 ⇒ tóm tắt ⇒ đóng gói (×3 ngày liên tiếp, mỗi ngày một lượt)", async () => {
    const { flowId, version } = await luuMau("bao-cao-ca.json", "bc");
    for (let ngay = 1; ngay <= 3; ngay++) {
      const bayGio = new Date(`2026-10-2${ngay}T23:00:00Z`); // 06:00 giờ Việt Nam hôm sau
      const runId = await banLich({ flowId, version, nodeId: "lich-6h", bayGio, cron: "0 6 * * *" });
      expect(runId).toBeTruthy();
      expect(await banLich({ flowId, version, nodeId: "lich-6h", bayGio })).toBeNull();
      await chayHet();
      expect((await layRun(runId!)).status).toBe("xong");
      const [v] = await raCua(runId!, "dong-goi");
      expect(v).toEqual({ baoCao: "Ca 3: sản lượng chưa có dữ liệu; không dừng máy nổi bật.", soItem: 1, loai: "bao-cao-ca", moc: `2026-10-2${ngay}T23:00Z` });
    }
    expect(goiGhi.map((g) => `${g.loai}:${g.vaiTro}`)).toEqual(["tom-tat:summarize", "tom-tat:summarize", "tom-tat:summarize"]);
  });
});
