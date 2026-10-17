/**
 * Điểm vào bundle của harness: MÃ THẬT của extension (`PhienAgent` ⇒ `chayVongAgent` của `shared/agentCore` +
 * `BoThucThiVscode` + `taoGoiModelV1` + `apBanVa` + `chayLenhCucBo`) cộng `vscode` GIẢ (tiêm qua esbuild, cùng một thể hiện
 * với `vscodeGia` xuất ở đây để harness điều khiển). KHÔNG có dòng nào của vòng agent được viết lại ở harness.
 */
export { PhienAgent } from "../../../../vscode-extension/src/ui/phienAgent";
export { KhoDeXuat } from "../../../../vscode-extension/src/ui/diffDeXuat";
export { KHOA_TOKEN_GATEWAY } from "../../../../vscode-extension/src/loi/thietBi";
export { xetDuyetLenh } from "../../../../vscode-extension/src/loi/lenhChoPhep";
export { duocPhepRoiMay } from "../../../../vscode-extension/src/loi/nguCanh";
export * as vscodeGia from "./vscodeGia";
