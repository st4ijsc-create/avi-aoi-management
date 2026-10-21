/**
 * ★ Đợt 9 — ĐẶT GÁN vai trò → model qua ĐÚNG cổng `datGanModel` (server/services/ai/soModel/datGan.ts: active cần ≥ 1 lượt đo +
 * giấy phép ≠ unknown; lịch sử retiredAt trong một giao dịch) — không SQL tay. Rồi KIỂM bằng bộ định tuyến thật trên ảnh
 * sổ vừa nạp.
 *   npx tsx --env-file=.env scripts/ai-eval/dat-gan-vai-tro.mts --vai-tro extract --pham-vi be-mat --ma luong \
 *     --ho-so qwen3.6-35b-a3b@64k [--du-phong a,b] [--che-do active] [--chi-kiem]
 */
import { getDb } from "../../server/db/connection";
import { datGanModel } from "../../server/services/ai/soModel/datGan";
import { napAnhSoModel } from "../../server/services/ai/soModel/napSoModel";
import { dinhTuyenVaiTro } from "../../server/services/ai/soModel/dinhTuyenVaiTro";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const vaiTro = arg("--vai-tro")!;
const phamVi = arg("--pham-vi", "global") as "global" | "tenant" | "project" | "flow" | "be-mat";
const ma = arg("--ma") ?? null;
const hoSo = arg("--ho-so")!;
const duPhong = (arg("--du-phong", "") ?? "").split(",").filter(Boolean);
const cheDo = arg("--che-do", "active") as "active" | "shadow" | "thu";

const db = await getDb();
if (!db) throw new Error("không có CSDL");
if (!process.argv.includes("--chi-kiem")) {
  const kq = await datGanModel(db, { roleId: vaiTro, scopeKind: phamVi, scopeId: phamVi === "global" ? null : ma, profileId: hoSo, envKey: null, fallback: duPhong, mode: cheDo }, null);
  console.log(`GÁN: id ${kq.id} · thay ${kq.daThay} hàng cũ · ${vaiTro} @ ${phamVi}/${ma ?? "-"} → ${hoSo} (${cheDo}) · dự phòng [${duPhong.join(", ")}]`);
}
const anh = await napAnhSoModel(db);
if (!anh) throw new Error("không nạp được ảnh sổ");
const yc = { vaiTro, phamVi: phamVi === "be-mat" ? { beMat: ma ?? undefined } : phamVi === "flow" ? { flowId: ma ?? undefined } : {}, khongDoiKhe: true };
for (const giu of ["Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", "Qwen3.6-27B-UD-Q4_K_XL.gguf"]) {
  const kq = dinhTuyenVaiTro(yc, anh, { ...process.env, LLAMA_SERVER_MODEL: giu });
  console.log(`KIỂM khe giữ ${giu}: ${JSON.stringify({ model: kq.model, nguon: kq.nguon, phamVi: kq.phamVi, lyDo: kq.lyDo.bangChung })}`);
}
const ngoai = dinhTuyenVaiTro({ vaiTro }, anh, process.env);
console.log(`KIỂM ngoài Luồng (không phạm vi): ${JSON.stringify({ model: ngoai.model, nguon: ngoai.nguon, phamVi: ngoai.phamVi })}`);
process.exit(0);
