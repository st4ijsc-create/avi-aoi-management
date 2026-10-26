/**
 * Vỏ chạy MCP cục bộ — `npx tsx scripts/mcp-cuc-bo.ts` (đọc `.env` của thư mục hiện hành).
 *   MCP_CUC_BO_CONG     cổng nghe trên 127.0.0.1 (mặc định 8811)
 *   MCP_CUC_BO_TOKEN    bearer bắt buộc (khuyến nghị; vắng ⇒ cảnh báo, ai trên máy cũng gọi được)
 *   MCP_CUC_BO_THU_MUC  gốc tệp: `ten=D:\duong\dan[:ro]; ...`
 *   MCP_CUC_BO_DB_URL   chuỗi kết nối của vai trò `mcp_chi_doc` (scripts/mcp-cuc-bo-vai-tro.mjs) — vắng ⇒ không có tool DB
 * Xem server/services/mcpCucBo/mayChu.ts.
 */
import { config } from "dotenv";
import { taoKetNoiDb } from "../server/services/mcpCucBo/dbChiDoc";
import { taoMayChuHttp } from "../server/services/mcpCucBo/mayChu";
import { docGocTuEnv } from "../server/services/mcpCucBo/tepAnToan";

config({ quiet: true });

const cong = Number(process.env.MCP_CUC_BO_CONG ?? 8811);
if (!Number.isInteger(cong) || cong < 1024 || cong > 65535) throw new Error("MCP_CUC_BO_CONG phải là số nguyên 1024–65535");
const token = process.env.MCP_CUC_BO_TOKEN?.trim() || undefined;
if (token && token.length < 24) throw new Error("MCP_CUC_BO_TOKEN quá ngắn (≥ 24 ký tự)");
const goc = docGocTuEnv(process.env.MCP_CUC_BO_THU_MUC);
const dbUrl = process.env.MCP_CUC_BO_DB_URL?.trim();
if (dbUrl && /\/\/(aoi|postgres|avi_app)[:@]/i.test(dbUrl)) throw new Error("MCP_CUC_BO_DB_URL phải dùng vai trò mcp_chi_doc, không dùng vai trò chủ / ứng dụng");
const db = (dbUrl ? taoKetNoiDb(dbUrl) : null) ?? undefined;

const ghiNhatKy = (d: Record<string, unknown>) => process.stdout.write(JSON.stringify(d) + "\n");
const mayChu = taoMayChuHttp({ cong, token, goc, db, ghiNhatKy });
mayChu.listen(cong, "127.0.0.1", () => {
  ghiNhatKy({
    luc: new Date().toISOString(),
    su: "khoi-dong",
    url: `http://127.0.0.1:${cong}/mcp`,
    token: token ? "bat-buoc" : "TAT (canh bao)",
    goc: goc.map((g) => `${g.ten}${g.chiDoc ? ":ro" : ""}`),
    db: db ? "bat" : "tat",
  });
});
const dung = () => {
  mayChu.close();
  void db?.dong().finally(() => process.exit(0));
  if (!db) process.exit(0);
};
process.on("SIGINT", dung);
process.on("SIGTERM", dung);
