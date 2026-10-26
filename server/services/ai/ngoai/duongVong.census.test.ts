/**
 * ★★ Đợt 10.3 Task 10 (B4, rà kiem-dinh mục 12) — CENSUS AST mọi điểm gọi NGUYÊN THUỶ ra mạng trong TOÀN `server/` (trừ `*.test.ts`,
 * `__fixtures__`): `fetch(` toàn cục, import / require / import() của `http`, `https`, `net`, `tls`, `undici`, `axios`, `ws`, và
 * `new WebSocket(`. Mỗi TỆP có điểm phải thuộc MỘT nhóm:
 *   (a) tệp có gọi `chanHostAiNgoai(` (rào chống nhầm của Luồng);
 *   (b) cổng AI ngoài (`server/services/ai/ngoai/mangNgoai.ts`) hoặc mô-đun mạng nền nó dùng (`flow/nut/mangAnToan.ts`);
 *   (c) `MIEN_TRU` — số điểm GHIM + lý do một dòng.
 * Tệp mới có điểm mà không thuộc nhóm nào, hay số điểm của tệp đổi ⇒ ĐỎ (đo lại, ghi lý do). Đây là rào chống NHẦM, không chống người có
 * quyền sửa mã. `chi-http-mcp-co-url`: chỉ node `tich-hop.http-*` / `tich-hop.mcp-goi` được có tham số dạng URL.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MO_DUN_MANG = new Set(["http", "https", "net", "tls", "undici", "axios", "ws", "http2", "dgram"].flatMap((m) => [m, `node:${m}`]));

/** Các điểm gọi mạng nguyên thuỷ của một tệp (nhãn; trùng nhãn được đếm từng lần). */
export function diemMang(duongDan: string, noiDung: string): string[] {
  const sf = ts.createSourceFile(duongDan, noiDung, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ra: string[] = [];
  const chuoi = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : null);
  const duyet = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const m = chuoi(n.moduleSpecifier);
      if (m && MO_DUN_MANG.has(m) && !n.importClause?.isTypeOnly) ra.push(`import:${m.replace(/^node:/, "")}`);
    } else if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(c) && c.text === "require")) {
        const m = chuoi(n.arguments[0]);
        if (m && MO_DUN_MANG.has(m)) ra.push(`import:${m.replace(/^node:/, "")}`);
      } else if (ts.isIdentifier(c) && c.text === "fetch") ra.push("fetch");
      else if (ts.isPropertyAccessExpression(c) && c.name.text === "fetch" && ts.isIdentifier(c.expression) && ["globalThis", "global", "window"].includes(c.expression.text)) ra.push("fetch");
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "WebSocket") ra.push("new-WebSocket");
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return ra;
}

function lietKe(thuMuc: string, ra: string[] = []): string[] {
  for (const f of readdirSync(thuMuc)) {
    if (f === "node_modules" || f === "dist" || f === "__fixtures__") continue;
    const p = join(thuMuc, f);
    if (statSync(p).isDirectory()) lietKe(p, ra);
    else if (/\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.(ts|tsx|mjs|js)$/.test(f) && !/\.d\.ts$/.test(f)) ra.push(p);
  }
  return ra;
}

const CONG = new Set(["server/services/ai/ngoai/mangNgoai.ts", "server/services/flow/nut/mangAnToan.ts"]);

/** Tệp → { so: số điểm GHIM, lyDo }. Đo 2026-10-26 (do-model). */
const MIEN_TRU: Readonly<Record<string, { so: number; lyDo: string }>> = {
  "server/_core/aiReadiness.ts": { so: 2, lyDo: "thăm sức khoẻ máy suy luận cục bộ (127.0.0.1) cho trang sẵn sàng AI" },
  "server/_core/dataApi.ts": { so: 1, lyDo: "⚠ dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl, quản trị cấu hình) — đường dịch vụ ngoài CÓ SẴN ngoài cổng AI ngoài; báo dieu-phoi" },
  "server/_core/imageGeneration.ts": { so: 1, lyDo: "⚠ dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl, quản trị cấu hình) — đường dịch vụ ngoài CÓ SẴN ngoài cổng AI ngoài; báo dieu-phoi (sinh ảnh)" },
  "server/_core/index.ts": { so: 5, lyDo: "máy chủ HTTP/HTTPS của ứng dụng + proxy tải tệp lưu trữ nội bộ (URL ký sẵn của kho tệp)" },
  "server/_core/llm.ts": { so: 1, lyDo: "tải ẢNH đính kèm (URL do người dùng đưa) để chuyển cho model CỤC BỘ — chiều vào, không gửi dữ liệu" },
  "server/_core/map.ts": { so: 1, lyDo: "⚠ dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl, quản trị cấu hình) — đường dịch vụ ngoài CÓ SẴN ngoài cổng AI ngoài; báo dieu-phoi (bản đồ)" },
  "server/_core/notification.ts": { so: 1, lyDo: "⚠ dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl, quản trị cấu hình) — đường dịch vụ ngoài CÓ SẴN ngoài cổng AI ngoài; báo dieu-phoi (thông báo chủ dự án)" },
  "server/_core/oauth.ts": { so: 2, lyDo: "OAuth — đổi mã / đọc hồ sơ ở máy chủ xác thực đã cấu hình" },
  "server/_core/sdk.ts": { so: 1, lyDo: "axios cho máy chủ OAuth đã cấu hình (khung gốc)" },
  "server/_core/socket.ts": { so: 5, lyDo: "socket.io / WebSocket của ứng dụng + thăm /health của thiết bị edge trong nhà máy" },
  "server/_core/vite.ts": { so: 1, lyDo: "máy chủ dev Vite (chỉ môi trường phát triển)" },
  "server/_core/voiceTranscription.ts": { so: 2, lyDo: "⚠ dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl, quản trị cấu hình) — đường dịch vụ ngoài CÓ SẴN ngoài cổng AI ngoài; báo dieu-phoi (chuyển giọng nói) + tải tệp âm thanh" },
  "server/routers/aiLocalKbRouter.ts": { so: 1, lyDo: "KB API CỤC BỘ (KB_API_BASE 127.0.0.1) — không phải máy chủ AI ngoài" },
  "server/routers/aoiPackageRouter.ts": { so: 2, lyDo: "tải gói AOI từ kho tệp nội bộ (URL ký sẵn)" },
  "server/routers/goldenSampleRouter.ts": { so: 1, lyDo: "tải ảnh mẫu vàng từ kho tệp nội bộ" },
  "server/routers/sitesRouter.ts": { so: 1, lyDo: "liên kết nhà máy (federation) — GET tới site đã đăng ký bởi quản trị" },
  "server/routers/webhookRouter.ts": { so: 1, lyDo: "⚠ đích do QUẢN TRỊ cấu hình NGOÀI Luồng (webhook / ERP / SIEM / cảnh báo / giao báo cáo) — không phải đường của Luồng; rủi ro còn lại: quản trị trỏ tới máy chủ AI — báo dieu-phoi" },
  "server/routes/edgeDownload.ts": { so: 1, lyDo: "proxy tải bản dựng edge từ kho tệp nội bộ" },
  "server/routes/reportArtifactRoutes.ts": { so: 1, lyDo: "proxy tải tệp báo cáo từ kho tệp nội bộ" },
  "server/services/ai/chayUngDung/capCong.ts": { so: 1, lyDo: "cấp cổng TCP cục bộ cho ứng dụng xem trước (127.0.0.1)" },
  "server/services/ai/chayUngDung/cungSite.ts": { so: 1, lyDo: "kiểm cổng cục bộ cùng site (127.0.0.1)" },
  "server/services/ai/chayUngDung/proxyXemTruoc.ts": { so: 2, lyDo: "proxy xem trước ứng dụng chạy CỤC BỘ (127.0.0.1)" },
  "server/services/ai/doiModelLlamaServer.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/ai/hoSoModelStudio.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/ai/napServerNgoai.ts": { so: 1, lyDo: "thăm /v1/models của máy suy luận do quản trị khai cho Studio (tên 'ngoài' = ngoài tiến trình, không phải AI ngoài) — GET, không gửi dữ liệu" },
  "server/services/ai/ollamaLui.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/ai/soModel/kheNangMacDinh.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/aiEdgeDeployment.ts": { so: 1, lyDo: "triển khai model tới thiết bị edge trong nhà máy (IP đã đăng ký)" },
  "server/services/aiEdgeEnhanced.ts": { so: 1, lyDo: "thiết bị edge trong nhà máy (IP đã đăng ký)" },
  "server/services/aiImageEmbedding.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài (embedding ảnh)" },
  "server/services/aiLlamaServerClient.ts": { so: 7, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/aiLocalKnowledgeService.ts": { so: 4, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài (OLLAMA_BASE_URL)" },
  "server/services/aiLocalTools/intentClassifier.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài" },
  "server/services/aoiImageEmbeddingWorker.ts": { so: 1, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài (embedding ảnh AOI)" },
  "server/services/edge/__edgeE2eHarness.dot10.ts": { so: 3, lyDo: "giả lập / khung thử chỉ dùng trong lưới (tiền tố __) — không chạy ở sản xuất" },
  "server/services/fcmService.ts": { so: 2, lyDo: "đẩy thông báo FCM (Google) — đích cố định, không phải máy chủ AI" },
  "server/services/federation/siteClient.ts": { so: 1, lyDo: "liên kết nhà máy (federation) — site đã đăng ký bởi quản trị" },
  "server/services/instruments/scpiAdapter.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/instruments/zplPrinterAdapter.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/integration/erpOutbox.ts": { so: 1, lyDo: "⚠ đích do QUẢN TRỊ cấu hình NGOÀI Luồng (webhook / ERP / SIEM / cảnh báo / giao báo cáo) — không phải đường của Luồng; rủi ro còn lại: quản trị trỏ tới máy chủ AI — báo dieu-phoi" },
  "server/services/kbWebFetcher.ts": { so: 3, lyDo: "KB_FETCH (quyết 2026-10-26): GET nhập tài liệu từ URL do người vận hành cấp — chiều VÀO, không gửi thân/khoá, rào SSRF 5 lớp riêng; không áp chanHostAiNgoai" },
  "server/services/llamaVisionSidecar.ts": { so: 2, lyDo: "máy suy luận CỤC BỘ (llama-server / Ollama 127.0.0.1, URL từ env của quản trị) — không phải máy chủ AI ngoài (sidecar thị giác)" },
  "server/services/mcpCucBo/mayChu.ts": { so: 1, lyDo: "máy chủ MCP CỤC BỘ của ứng dụng (lắng nghe, không gọi ra)" },
  "server/services/mtconnect/mtconnectClient.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet (MTConnect agent)" },
  "server/services/ot/drivers/__s7commSim.ts": { so: 1, lyDo: "giả lập / khung thử chỉ dùng trong lưới (tiền tố __) — không chạy ở sản xuất" },
  "server/services/ot/drivers/s7BlockChecksum.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/ot/drivers/slmpDriver.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/pdfTemplateService.ts": { so: 1, lyDo: "tải LOGO công ty (URL quản trị đặt) cho PDF — GET, chiều vào" },
  "server/services/programming/zmotion/zmotionBasicAdapter.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/reportDeliveryService.ts": { so: 2, lyDo: "⚠ đích do QUẢN TRỊ cấu hình NGOÀI Luồng (webhook / ERP / SIEM / cảnh báo / giao báo cáo) — không phải đường của Luồng; rủi ro còn lại: quản trị trỏ tới máy chủ AI — báo dieu-phoi (+ SendGrid cố định)" },
  "server/services/robot/drivers/__fakeTechman.ts": { so: 1, lyDo: "giả lập / khung thử chỉ dùng trong lưới (tiền tố __) — không chạy ở sản xuất" },
  "server/services/robot/drivers/fanucDriver.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/robot/drivers/tcpLineClient.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/robot/drivers/techmanDriver.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/robot/ursim/__fakeUrController.ts": { so: 1, lyDo: "giả lập / khung thử chỉ dùng trong lưới (tiền tố __) — không chạy ở sản xuất" },
  "server/services/robot/ursim/simTargetRegistry.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet (đích mô phỏng UR)" },
  "server/services/robot/ursim/ursimClient.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet" },
  "server/services/ros2/rosbridgeClient.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet (rosbridge)" },
  "server/services/secsgem/hsmsClient.ts": { so: 1, lyDo: "driver thiết bị OT/đo lường trong nhà máy (TCP tới IP máy đã khai) — không phải HTTP ra Internet (SECS/GEM HSMS)" },
  "server/services/security/secretManager.ts": { so: 1, lyDo: "kho bí mật (Vault) quản trị cấu hình" },
  "server/services/security/siemExporter.ts": { so: 3, lyDo: "⚠ đích do QUẢN TRỊ cấu hình NGOÀI Luồng (webhook / ERP / SIEM / cảnh báo / giao báo cáo) — không phải đường của Luồng; rủi ro còn lại: quản trị trỏ tới máy chủ AI — báo dieu-phoi" },
  "server/services/universalExportService.ts": { so: 1, lyDo: "tải LOGO công ty (URL quản trị đặt) cho báo cáo — GET, chiều vào" },
  "server/storage.ts": { so: 3, lyDo: "⚠ kho tệp qua dịch vụ 'forge' của khung gốc (ENV.forgeApiUrl) — BUILT_IN_FORGE_API_URL rỗng = tắt; đặt = mở đường ngoài cổng, cần chủ dự án (§12)" },
  "server/utils/spcAlertSink.ts": { so: 1, lyDo: "⚠ đích do QUẢN TRỊ cấu hình NGOÀI Luồng (webhook / ERP / SIEM / cảnh báo / giao báo cáo) — không phải đường của Luồng; rủi ro còn lại: quản trị trỏ tới máy chủ AI — báo dieu-phoi" },
};
/** GHIM: số tệp miễn trừ + tổng điểm — đổi ⇒ đo lại + ghi lý do (ratchet). */
const GHIM = { tep: 64, diem: 97 } as const;

const tatCa = (() => {
  const m: Record<string, { diem: string[]; chan: boolean }> = {};
  for (const p of lietKe(join(GOC, "server"))) {
    const src = readFileSync(p, "utf8");
    const diem = diemMang(p, src);
    if (diem.length) m[relative(GOC, p).split(sep).join("/")] = { diem, chan: /\bchanHostAiNgoai\(/.test(src) };
  }
  return m;
})();

describe("census đường vòng — điểm gọi ra mạng trong server/", () => {
  it("bộ dò bắt đủ dạng (đối chứng)", () => {
    const mau = `import http from "node:http"; import type { Agent } from "undici"; const a = await import("https"); const b = require("net");
      await fetch("x"); await globalThis.fetch("y"); new WebSocket("z"); obj.fetch("khong"); import { x } from "./http";`;
    expect(diemMang("mau.ts", mau)).toEqual(["import:http", "import:https", "import:net", "fetch", "fetch", "new-WebSocket"]);
  });

  it("mọi tệp có điểm thuộc (a) gọi chanHostAiNgoai, (b) cổng, hoặc (c) MIEN_TRU đúng số điểm", () => {
    const sai: string[] = [];
    for (const [tep, { diem, chan }] of Object.entries(tatCa)) {
      if (chan || CONG.has(tep)) continue;
      const m = MIEN_TRU[tep];
      if (!m) sai.push(`${tep}: ${diem.length} điểm (${[...new Set(diem)].join(", ")}) — chưa thuộc nhóm nào`);
      else if (m.so !== diem.length) sai.push(`${tep}: GHIM ${m.so} điểm, đo ${diem.length}`);
    }
    for (const tep of Object.keys(MIEN_TRU)) if (!tatCa[tep]) sai.push(`${tep}: miễn trừ thừa (không còn điểm)`);
    expect(sai).toEqual([]);
    expect({ tep: Object.keys(MIEN_TRU).length, diem: Object.values(MIEN_TRU).reduce((t, m) => t + m.so, 0) }).toEqual(GHIM);
    expect(Object.values(MIEN_TRU).every((m) => m.lyDo.trim().length >= 10)).toBe(true);
  });

  it("mọi tệp dùng lớp mạng ghim IP của Luồng (kiemDichDen / fetchGhim) ngoài cổng đều gọi chanHostAiNgoai — hiện: tichHop, mcpKhach", () => {
    const dung: string[] = [];
    for (const p of lietKe(join(GOC, "server"))) {
      const tep = relative(GOC, p).split(sep).join("/");
      if (CONG.has(tep)) continue;
      const src = readFileSync(p, "utf8");
      if (/\b(kiemDichDen|fetchGhim)\(/.test(src)) dung.push(`${tep}:${/\bchanHostAiNgoai\(/.test(src)}`);
    }
    expect(dung.sort()).toEqual(["server/services/flow/nut/mcpKhach.ts:true", "server/services/flow/nut/tichHop.ts:true"]);
  });
});

describe("chi-http-mcp-co-url — chỉ node tich-hop.http-* / tich-hop.mcp-goi đọc tham số dạng URL", () => {
  // `dich` của plan bị bỏ khỏi mẫu: ở logic.chon / du-lieu.loc nó là GIÁ TRỊ SO SÁNH, không phải đích mạng (đo 2026-10-26).
  const RE_URL = /\.(url|endpoint|baseUrl|uri)\b|["'](url|endpoint|baseUrl|uri)["']\s*:/i;
  it("mã node: chỉ tichHop.ts + mcpKhach.ts có truy cập .url / .endpoint / .baseUrl / .uri", () => {
    const thuMuc = join(GOC, "server", "services", "flow", "nut");
    const co = readdirSync(thuMuc)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => RE_URL.test(readFileSync(join(thuMuc, f), "utf8")))
      .sort();
    expect(co).toEqual(["mcpKhach.ts", "tichHop.ts"]);
  });

  it("mẫu luồng (flow/mau/*.json): tham số tên URL chỉ ở node http / mcp", () => {
    const thuMuc = join(GOC, "server", "services", "flow", "mau");
    const sai: string[] = [];
    for (const f of readdirSync(thuMuc).filter((x) => x.endsWith(".json"))) {
      const def = JSON.parse(readFileSync(join(thuMuc, f), "utf8")) as { nodes?: { id: string; type: string; parameters?: Record<string, unknown> }[] };
      for (const n of def.nodes ?? []) {
        const k = Object.keys(n.parameters ?? {}).filter((x) => /^(url|endpoint|baseUrl|host|uri)$/i.test(x));
        if (k.length && !/^tich-hop\.(http-|mcp-goi$)/.test(n.type)) sai.push(`${f}#${n.id} (${n.type}): ${k.join(",")}`);
      }
    }
    expect(sai).toEqual([]);
  });
});
