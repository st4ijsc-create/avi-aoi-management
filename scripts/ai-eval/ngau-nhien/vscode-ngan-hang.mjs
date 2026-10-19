/**
 * Cầu nối ĐƯỜNG (c): biến bài của kho ngẫu nhiên thành bài của bộ đầu-cuối VSCode (`scripts/ai-eval/vscode-e2e`).
 * Nạp qua `AI_EVAL_NGAN_HANG=<tệp này>` (hook trong `vscode-e2e/lib/bai.mjs`); danh sách bài đã chọn + trạng thái test
 * hiển thị trên khung do `vscode.mjs` tính sẵn và truyền qua `AI_EVAL_NN_CHON` (JSON).
 *
 * Chỉ kiểu chấm mà `agent-f/cham.mjs` (bộ chấm của vscode-e2e) hiểu: node · pytest · dotnet. Bài cần node_modules của
 * repo (React) bị loại: workspace VSCode nằm dưới %TEMP%, không thấy node_modules của repo.
 */
import { docKho } from "./lib/kho.mjs";
import { taoCauHoiAgent } from "./lib/cauHoi.mjs";

export const KIEU_VSCODE = new Set(["node", "pytest", "dotnet"]);
export const hopLeVscode = (b) => KIEU_VSCODE.has(b.kieu) && !b.canNodeModulesRepo;

const tenTep = (rel) => rel.split("/").pop().replace(/\.cs$/, "");

export function chuyenBai(b, hienThiDoTruoc) {
  return {
    id: b.id,
    lang: b.lang,
    kieu: b.kieu,
    nhieuTep: b.nhieuTep,
    loai: "tinh-nang",
    cauHoi: taoCauHoiAgent(b, null),
    testHienThi: b.testHienThi,
    testAn: b.testAn,
    tepBaoVe: b.tepBaoVe,
    soTest: b.soTest,
    tranGiayMs: (b.tranGiay ?? (b.kieu === "dotnet" ? 360 : 120)) * 1000,
    hienThiDoTruoc,
    nguonAbs: b.khungAbs,
    phuAbs: null,
    anAbs: b.anAbs,
    mauAbs: b.mauAbs,
    nguonGoc: `ngẫu nhiên (${b.vanTay})`,
    ...(b.kieu === "dotnet" ? { dotnet: { duAnTest: "Bai.csproj", lopTest: [...b.testHienThi, ...b.testAn].map((t) => `KiemThu.${tenTep(t)}`) } } : {}),
  };
}

export function docNganHangVscode() {
  const chon = JSON.parse(process.env.AI_EVAL_NN_CHON ?? "[]");
  if (!chon.length) throw new Error("AI_EVAL_NN_CHON rỗng — chạy qua scripts/ai-eval/ngau-nhien/vscode.mjs");
  const kho = new Map(docKho({ only: chon.map((c) => c.id).join(",") }).map((b) => [b.id, b]));
  return chon.map((c) => {
    const b = kho.get(c.id);
    if (!b) throw new Error(`bài ${c.id} không có trong kho`);
    return chuyenBai(b, c.hienThiDoTruoc);
  });
}
