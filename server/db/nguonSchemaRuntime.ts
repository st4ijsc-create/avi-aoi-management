/**
 * Nguồn bảng Drizzle CỦA TIẾN TRÌNH CHẠY THẬT, dùng cho kiểm schema chung lúc khởi động (`kiemSchemaChung.ts`) và lưới cổng
 * (`drizzleSchemaVsDb.db.test.ts`). Gồm:
 *   • barrel `drizzle/schema/index.ts` + hai tệp schema KHÔNG qua barrel (security, synapseObservability);
 *   • các bảng khai NGOÀI `drizzle/schema/` (hierarchy.ts, systemRouters.ts, edge*Schema, runApiKeyIdentity, robotCommandDispatcher) — bảng vận hành
 *     thật (edge / robot / STOP / enrollment) mà trước đây cả lưới lẫn kiểm khởi động không thấy.
 * Một số tệp khai chiếu MỘT PHẦN của bảng đã có (orchestration_runs, api_keys, robots…): `bangKhaiTuModule` hợp cột theo tên bảng.
 *
 * Lưới cổng quét `pgTable("tên"` trong `server/**` (trừ test) và đòi MỌI tên phải nạp được từ đây ⇒ thêm tệp khai bảng mới mà quên đăng ký ở đây là đỏ.
 * Nặng (kéo router/dịch vụ) ⇒ chỉ nạp ĐỘNG; đừng import tệp này từ đường nóng.
 */
import * as schemaBarrel from "../../drizzle/schema";
import * as schemaSecurity from "../../drizzle/schema/security";
import * as schemaSynapseObs from "../../drizzle/schema/synapseObservability";
import * as dbHierarchy from "./hierarchy";
import * as routersSystem from "../routers/systemRouters";
import * as edgeControl from "../services/edge/edgeControlSchema";
import * as edgeExecution from "../services/edge/edgeExecutionSchema";
import * as runApiKey from "../services/orchestration/foe/runApiKeyIdentity";
import * as robotDispatcher from "../services/robot/robotCommandDispatcher";

export const NGUON_SCHEMA_RUNTIME: ReadonlyArray<Record<string, unknown>> = [
  schemaBarrel,
  schemaSecurity,
  schemaSynapseObs,
  dbHierarchy,
  routersSystem,
  edgeControl,
  edgeExecution,
  runApiKey,
  robotDispatcher,
];
