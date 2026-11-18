/**
 * ★★★ CENSUS AST (T2 của lượt sửa gốc A2(n), 14/11) — "CHỮ KHÔNG PHẢI TRẠNG THÁI".
 *
 * Central và edge không được suy trạng thái an toàn (nợ STOP, kết cục không rõ, chốt run, giữ run, phân loại STOP, URGENT)
 * từ CHỮ (chuỗi lỗi, thông điệp thư viện, rider trong chuỗi). Tệp này KHÔNG sửa hành vi: nó ĐÓNG BĂNG mọi chỗ đọc chữ đang có
 * (bảng kiểm kê `thuc-thi\T9\kiem-ke-chu\bang.md`, cập nhật tới `27f9b47ac`) và ĐỎ khi:
 *   (1) có chỗ khớp mới mà không có dòng đóng băng;
 *   (2) có dòng đóng băng mà mã không còn ⇒ thông báo "xoá dòng X khỏi danh sách";
 *   (3) số dòng đóng băng KHÁC `SO_DONG_MOC`, hoặc `LICH_SU_MOC` tăng (HST 14/11 T2-DK3: mốc chỉ được GIẢM);
 *   (4) một ca test giữ ô "ngoài tầm" bị xoá / đổi tên, hoặc `CHUA_CO_CA` đổi mà không sửa có chủ ý (HST 14/11 T2-DK1).
 *
 * Luật quét (đi AST bằng TypeScript compiler API, không dùng regex dòng ⇒ lời gọi xuống dòng và optional chaining đều thấy):
 *   L1  `.startsWith/.endsWith/.includes/.match/.indexOf/.split/.replace(…)` áp trên biểu thức có ĐỊNH DANH CUỐI là
 *       `error|err|message|detail|reason|text|msg|errorText` hoặc bắt đầu bằng `loi`/`raw` (hoặc đúng một bộ tệp + hàm bao + định danh
 *       trong `CAP_DINH_DANH`: A1-38, A1-39, A1-41); `.test(…)`/`.exec(…)` (regex literal hay hằng regex) và `JSON.parse(…)` áp trên
 *       đối số như vậy. Định danh cuối được bóc qua ngoặc, `!`, `as`, `?.`, `String(x)`, `?? / ||`, `a ? b : c`, template `${…}`, phép `+`
 *       và các phép biến chữ `toLowerCase`, `toUpperCase`, `trim…`, `toString`, `slice`, `substring`, `substr`, `normalize`.
 *       I3 (lượt sửa 1): đối tượng lỗi (`e`/`err`/`error`, hoặc biến của `catch` bao quanh) bị ÉP thành chuỗi (`String(e)`,
 *       `e.toString()`, `${e}`, `e + ""`) cũng là chữ.
 *   L1-BẰNG (I2, lượt sửa 1) — chỉ với chữ TỰ DO (tập trên bỏ `reason`, `detail`): `=== !== == !=` với chuỗi / template literal (bỏ
 *       `typeof x === "…"`), `switch (chữ)`, và ĐỐI SỐ của `.includes` / `.has` / `.indexOf`.
 *   L2  hằng chuỗi bắt đầu bằng `FOE_`, `EDGE_` hoặc `[[A2N` (bỏ khoảng trắng đầu; regex: chứa) khi nằm trong phép so chữ:
 *       đối số (hoặc mảng nhận) của các phép ở L1, nhận của `.test/.exec`, toán hạng `=== !== == !=`, nhãn `case`.
 *       Định danh được giải về giá trị `const` cấp tệp của MỌI tệp trong phạm vi (và tệp chúng import trực tiếp, một tầng); không giải
 *       được mà là định danh trần tên `FOE_*`/`EDGE_*` ⇒ tính.
 *   L3  mọi nơi gọi / tham chiếu tới hàm trung gian đã biết "đọc chữ rồi trả trạng thái" (`HAM_TRUNG_GIAN`, kể cả qua bí danh import
 *       `import { x as y }`; trừ chỗ khai báo, import/export, vị trí kiểu). Đây là lưới bù cho giới hạn [H7]: chữ đi qua hàm trung gian
 *       thì L1 không thấy.
 *
 * Khoá của một dòng = tệp + hàm bao + phép so + đoạn chữ dựng từ AST (`chuAst`: định danh, literal, token; bỏ chú thích, ngoặc nhóm, `;`,
 * dấu phẩy treo; arrow luôn có ngoặc tham số) ⇒ `npm run format` (prettier của repo) không đổi khoá. KHÔNG dùng số dòng.
 * Đối chiếu là theo BỘ ĐẾM (multiset): hai chỗ y hệt trong cùng hàm là hai dòng.
 *
 * GIỚI HẠN ĐÃ BIẾT (census KHÔNG bắt; bảng kiểm kê theo Ô vẫn là nguồn chính, kế hoạch T2 [H7]; kiem-dinh đối chiếu theo Ô ở bước gộp):
 *   - bí danh biến / đổi tên: `const m = err.message; m.startsWith(…)` (ví dụ có thật: `ethernetIpDriver.ts` `laQuaHanGhiEip`, chỉ thấy qua L3),
 *     destructuring đổi tên `const { message: m } = err`, tên biến ngoài tập (`reply`, `outcome`, `data`… ngoài `CAP_DINH_DANH`);
 *   - chữ đi qua hàm trung gian MỚI chưa có tên trong `HAM_TRUNG_GIAN`, hay đi qua đối tượng / mảng rồi mới so;
 *   - phép `lastIndexOf`, `search`, `matchAll`, `localeCompare` (R-i: `lastIndexOf` ở `tachBaoCaoKhongRoEdge` chỉ thấy qua các phép khác của
 *     cùng hàm và qua L3);
 *   - so bằng / thuộc tập trên `reason`, `detail` với chuỗi không tiền tố (cố ý: hai tên này phần lớn là mã có cấu trúc);
 *   - hằng tiền tố là thành viên enum, static của lớp, thuộc tính của object mã, const không ở cấp tệp, re-export từ hai tầng trở lên (Minor m2:
 *     không giải; hiện không có trong phạm vi);
 *   - sửa đồng thời `LICH_SU_MOC` / `MOC_GOC` cùng danh sách (cổng rà phải bắt bằng QUYET_DINH_MOC trong commit);
 *   - phép so trong SQL (A1-31) và dữ liệu có cấu trúc: xem `O_NGOAI_TAM` (HST 14/11 T2-DK1).
 *
 * Test thuần: chỉ đọc tệp nguồn trong repo (CRLF → LF), không DB, không mạng, không đồng hồ.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Phạm vi quét và loại trừ (mỗi loại trừ có lý do)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Gốc thư mục quét đệ quy. */
const GOC_QUET: readonly string[] = [
  "server/services/orchestration/foe",
  "server/services/edge",
  "server/services/robot", // gồm robot/drivers, robot/ursim
  "server/services/ot/drivers",
  "server/services/equipment", // A1-32, A1-37…A1-40 nằm ở đây hoặc đọc từ đây
];

/**
 * Tệp lẻ quét thêm: `server/services/ot/commandDispatcher*` (A1-21, A1-33, A1-34).
 * LOẠI TRỪ phần còn lại của `server/services/ot/**`: theo kế hoạch T2 [H7], chỗ đó không dựng trạng thái STOP từ chữ của thiết bị
 * hay của nút (chỉ drivers và dispatcher làm việc này).
 */
const TIEN_TO_TEP_LE = { thuMuc: "server/services/ot", tienTo: "commandDispatcher" } as const;

/**
 * Loại trừ theo tên tệp:
 *  - `*.test.ts`: tệp test, không chạy trong sản xuất (gồm chính tệp census này);
 *  - `*.testkit.ts`: bộ dựng cho test, không chạy trong sản xuất;
 *  - `__*`: phụ kiện test (fixture, sim giả, harness e2e), không chạy trong sản xuất.
 */
const LOAI_TRU_TEN: readonly { re: RegExp; lyDo: string }[] = [
  { re: /\.test\.[cm]?[jt]sx?$/, lyDo: "tệp test, không chạy trong sản xuất" },
  { re: /\.testkit\.[cm]?[jt]sx?$/, lyDo: "bộ dựng cho test, không chạy trong sản xuất" },
  { re: /^__/, lyDo: "phụ kiện test (fixture, sim giả, harness), không chạy trong sản xuất" },
];

/**
 * Đuôi tệp mã được quét: TS và JS (Minor m5). Tệp khác (json, md, sql, txt…) không phải mã chạy nên không có phép so chữ để quét.
 * Hiện phạm vi không có tệp `.js/.mjs/.cjs`; có thêm thì được quét luôn.
 */
const DUOI_MA = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function laTepLoaiTru(ten: string): boolean {
  return LOAI_TRU_TEN.some((l) => l.re.test(ten));
}

function tepTrongPhamVi(): string[] {
  const out: string[] = [];
  const di = (dir: string): void => {
    for (const ten of readdirSync(dir)) {
      // m5: `node_modules` là mã bên thứ ba, không phải central/edge của repo; mục bắt đầu bằng `.` là thư mục / tệp ẩn của công cụ
      // (`.vite`, `.cache`…), không phải mã sản xuất.
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (laTepLoaiTru(ten)) continue; // thư mục `__*` (nếu có) cũng là phụ kiện test
        di(p);
      } else if (DUOI_MA.test(ten) && !laTepLoaiTru(ten)) out.push(p);
    }
  };
  for (const g of GOC_QUET) di(resolve(GOC, g));
  const thuMucLe = resolve(GOC, TIEN_TO_TEP_LE.thuMuc);
  for (const ten of readdirSync(thuMucLe)) {
    if (ten.startsWith(TIEN_TO_TEP_LE.tienTo) && DUOI_MA.test(ten) && !laTepLoaiTru(ten)) out.push(resolve(thuMucLe, ten));
  }
  return out.map((p) => relative(GOC, p).replace(/\\/g, "/")).sort();
}

/** Chuẩn hoá CRLF → LF (bản làm việc trên Windows có thể là CRLF). */
export const veLf = (s: string): string => s.replace(/\r\n/g, "\n");
/** Đọc nguồn, luôn qua `veLf`. */
const docNguon = (rel: string): string => veLf(readFileSync(resolve(GOC, rel), "utf8"));

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Luật quét
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** L1: phép so chữ áp trên NHẬN (receiver). */
const PHEP_TREN_NHAN = new Set(["startsWith", "endsWith", "includes", "match", "indexOf", "split", "replace"]);
/** L1: phép so chữ áp trên ĐỐI SỐ đầu (regex literal hay hằng regex). */
const PHEP_TREN_DOI_SO = new Set(["test", "exec"]);
/** Phép biến chữ được bóc khi tìm định danh cuối. */
const PHEP_BIEN_CHU = new Set([
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "toString",
  "slice",
  "substring",
  "substr",
  "normalize",
]);

/**
 * `msg` thêm theo quyết định scada-master 14/11 (A1-35: `msg.startsWith(OPCUA_TIEN_TO_QUA_HAN)` ở opcuaDriver).
 * `errorText` thêm ở lượt sửa 1 (I4: cột chữ lỗi của command log, `commandDispatcher.ts` A1-33/A1-34). Đã grep phạm vi các trường
 * `*Text` / `*Error` / `*Msg` / `*Message` dùng trong phép so chữ: chỉ có `errorText`.
 */
const TEN_CHU_DUNG = new Set(["error", "err", "message", "detail", "reason", "text", "msg", "errorText"]);
export const laTenChu = (ten: string): boolean => TEN_CHU_DUNG.has(ten) || ten.startsWith("loi") || ten.startsWith("raw") || ten === DAU_EP_CHUOI;
/** I2 (so bằng / thuộc tập / switch): chỉ tên chữ TỰ DO; bỏ `reason`, `detail` (phần lớn là mã có cấu trúc, ví dụ `reason === "outcomeUnknown"`). */
export const laTenChuTuDo = (ten: string): boolean => ten !== "reason" && ten !== "detail" && laTenChu(ten);

/**
 * L1-CẶP: đúng cặp (tệp, định danh) cho các ô mà tên biến nằm ngoài tập trên (quyết định scada-master 14/11: KHÔNG mở luật tới
 * `outcome` / `reply` / `data` ở mọi nơi, vì ồn). Định danh so với chữ của biểu thức đích đã bỏ khoảng trắng, `?` và `!`.
 * Lượt sửa 1: thêm HÀM BAO vào cặp. Lý do: ở `edgeExecutionAgent.ts`, `r.outcome` của `handleCommand` / `resendStops` là kiểu hợp literal
 * `EdgeStopOutcome` ("sent" | "failed" | "simulated", `:269`), không phải chữ; chỉ `r.outcome` của `pullOnce` là chữ ghép `pending:` / `unverified:`.
 */
export const CAP_DINH_DANH: readonly { tep: string; ham: string; dinhDanh: string; o: string; lyDo: string }[] = [
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dinhDanh: "frame.header", o: "A1-38", lyDo: "đầu khung TM: khác TMSCT ⇒ tm_reply_unexpected (thêm ở lượt sửa 1)" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dinhDanh: "frame.data", o: "A1-38", lyDo: "id / kết quả trong khung TMSCT ⇒ ok / lỗi đã biết / không rõ" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dinhDanh: "result", o: "A1-38", lyDo: "phần kết quả của khung TMSCT (regex OK / ERROR)" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "UrsimBridgeDriver.getState", dinhDanh: "safety", o: "A1-39", lyDo: "chữ dashboard `safetystatus` ⇒ estop" },
  { tep: "server/services/robot/ursim/ursimClient.ts", ham: "UrsimClient.isProgramRunning", dinhDanh: "reply", o: "A1-39", lyDo: "chữ dashboard `running` ⇒ busy" },
  { tep: "server/services/edge/edgeExecutionAgent.ts", ham: "EdgeExecutionAgent.pullOnce", dinhDanh: "r.outcome", o: "A1-41", lyDo: "outcome `pending:` do agent đặt ⇒ hoãn STOP sang pha làm việc" },
];
const vanBanDich = (e: ts.Expression): string => boc(e).getText().replace(/\s+/g, "").replace(/[?!]/g, "");

/** L2: tiền tố của hằng chữ trạng thái. */
const TIEN_TO_HANG = ["FOE_", "EDGE_", "[[A2N"] as const;
const TEN_HANG_TIEN_TO = /^(FOE|EDGE)_[A-Z0-9_]*$/;

/**
 * L3: hàm trung gian "đọc chữ rồi trả trạng thái". Mỗi tên có nguồn (ô bảng) và lý do.
 * Danh sách RỘNG HƠN brief (brief: 3 tên + mục B, C, F, G): thêm các hàm phân loại mã trả về của driver (kế hoạch T2 [H7]) và các bộ đọc
 * chữ lõi của bảng A. Lý do: không có chúng thì một nơi gọi MỚI như `loiLaKetCucKhongRo(row.error)` không đỏ (chữ đi qua hàm trung gian
 * là giới hạn [H7] của L1), và khoảng 20 ô A1 không thấy được. scada-master CHẤP NHẬN ngày 14/11 (86 dòng `goi:` ở lúc đó).
 * `edgeOutcomeUnknownOf` không còn nơi gọi trong mã sản xuất ở `27f9b47ac` (chỉ test gọi); giữ tên để bắt nơi gọi mới.
 * Không có trong danh sách (đã xét, có lý do):
 *  - `runDaChotKhongRo`, `outcomeUnknownOf`, `buTruKhongRoCho`, `lyDoDongBoKhoa` (mục B): đọc ctx / resume state CÓ CẤU TRÚC;
 *    chữ chỉ vào qua `edgeOutcomeUnknownOf` / `tapKhongRoEdge` / `chotTuHang`, đã có tên ở đây.
 *  - `isEdgeUnavailableError`, `isEdgeControlSchemaMissing` (mục C): đọc `code` của lỗi PG (mã có cấu trúc), không đọc chữ.
 *  - `ganBaoCaoKhongRoEdge` (mục G): nơi SOẠN chữ, không đọc chữ để trả trạng thái.
 *  - `maKetCucKhongRoCua` (A1-29): chỉ chọn mã HIỂN THỊ, không đổi quyết định.
 *  - `nguonCuaKetQua`: nhận `status` + mã đã tách, có cấu trúc.
 */
export const HAM_TRUNG_GIAN: readonly { ten: string; nguon: string; lyDo: string }[] = [
  // brief T2 (đã biết)
  { ten: "tachBaoCaoKhongRoEdge", nguon: "A1-24, R-i", lyDo: "tách rider [[A2N:…]] khỏi chữ end ⇒ báo cáo STOP/không rõ" },
  { ten: "docDsKhongRoEdge", nguon: "A1-22 (mục 0)", lyDo: "đọc danh sách EDGE_OUTCOME_UNKNOWN(…) từ chữ end" },
  { ten: "edgeOutcomeUnknownOf", nguon: "A1-22, mục F", lyDo: "danh sách lệnh không rõ của đoạn edge, rơi xuống chữ" },
  // mục B, C, F, G: hàm đọc chữ rồi trả trạng thái
  { ten: "chotTuHang", nguon: "A1-14, mục B", lyDo: "chốt run suy từ chữ lỗi của hàng bước (loiLaKetCucKhongRo)" },
  { ten: "stopChuaRaTuHang", nguon: "A1-3, B-12", lyDo: "nợ STOP suy từ chữ lỗi của hàng bước (laHangMaChuaRa)" },
  { ten: "tapKhongRoEdge", nguon: "A1-22 (mục 0), B-1", lyDo: "tập không rõ cuối đoạn = HỢP(chữ, hàng + sổ)" },
  // kế hoạch T2 [H7]: "các hàm phân loại mã trả về của driver"
  { ten: "maTienTo", nguon: "A1-33", lyDo: "tách mã đầu chữ lỗi của dispatcher OT ⇒ hàng thiết bị hay không gửi" },
  { ten: "laQuaHanGhiEip", nguon: "A1-37", lyDo: "chữ lỗi thư viện EtherNet/IP ⇒ kết cục ghi không rõ" },
  { ten: "laQuaHanThuVienEip", nguon: "A1-37", lyDo: "chữ lỗi thư viện EtherNet/IP ⇒ phiên nhiễm" },
  { ten: "coTheDaBayCua", nguon: "A1-32", lyDo: "mã 'có thể đã bay' đọc từ chữ lỗi robot" },
  { ten: "maTuChoiCua", nguon: "A1-21", lyDo: "tuChoi/driverLoi của STOP đọc từ mã đầu chữ lỗi" },
  // bảng A / mục 0: bộ đọc chữ lõi (chữ đi qua chúng thì L1 không thấy ở nơi gọi)
  { ten: "loiLaKetCucKhongRo", nguon: "A1-14…A1-17", lyDo: "mã FOE/EDGE_OUTCOME_UNKNOWN ở bất kỳ đâu trong chữ ⇒ không rõ" },
  { ten: "laLoiKhongGuiChot", nguon: "A1-13", lyDo: "tiền tố FOE_NOT_SENT_RUN_LATCHED: ⇒ chưa gửi có chứng minh" },
  { ten: "viChuaRaCuaLoi", nguon: "A1-7, A1-8", lyDo: "[MA] ở đuôi chữ ⇒ nguồn 'chưa ra'" },
  { ten: "laHangMaChuaRa", nguon: "A1-1", lyDo: "tiền tố FOE_STOP_NOT_SENT: ⇒ nợ STOP" },
  { ten: "laHangChuaRa", nguon: "A1-1, A1-2", lyDo: "nợ STOP / settled của hàng (vế chữ qua laHangMaChuaRa)" },
  { ten: "edgeHoldMarkOf", nguon: "A1-25", lyDo: "dấu EDGE_HELD(x): MARK: trong chữ ⇒ lời khuyên Continue/Abort" },
  { ten: "docAnomalyKhongRo", nguon: "A1-28", lyDo: "JSON trong detail của anomaly ⇒ báo cáo URGENT" },
  { ten: "dauKhongRoTuEdge", nguon: "A1-19", lyDo: "id bước/bù trừ của dấu held đọc từ chữ" },
  { ten: "laLoiCuaKhoa", nguon: "A1-20", lyDo: "mã trong chữ khối chứa ⇒ đi vào khối để nêu việc bị bỏ" },
  { ten: "standardCodeToReason", nguon: "A1-40", lyDo: "từ khoá trong mã báo động ⇒ loại Andon safety" },
  { ten: "decodeRobotMode", nguon: "A1-39", lyDo: "chữ dashboard UR ⇒ mode robot" },
  // T4 (chu-du-an-HST 14/11, hướng (2): vá lỗ census) — hai hàm đọc chữ bên trong (qua chotTuHang / stopChuaRaTuHang / viChuaRaCuaLoi / loiLaKetCucKhongRo) mà trước đây không có tên ⇒ nơi gọi chúng không bị thấy
  { ten: "quyetDinhKetThucAnh", nguon: "T4 (MOI)", lyDo: "cổng kết thúc run: chốt (chotTuHang), nợ STOP (stopChuaRaTuHang), mã [MA] (viChuaRaCuaLoi) đọc từ chữ hàng ⇒ held / terminal / URGENT" },
  { ten: "edgeResumeStateOf", nguon: "T4 (MOI)", lyDo: "trạng thái tiếp tục của run edge từ hàng + sổ; cờ khongRo đọc từ chữ hàng (loiLaKetCucKhongRo) ⇒ không gửi lại / bù trừ cần người" },
  // T4 (HST hướng (b), sau đối chiếu của kiem-dinh 14/11, `_kd_out\htg_out.txt`) — ba hàm bọc nữa
  { ten: "buTruBiChanKhongRo", nguon: "T4 (MOI)", lyDo: "bù trừ bị chặn vì kết cục không rõ: đọc chữ hàng / resume state (loiLaKetCucKhongRo) ⇒ /authorize từ chối outcome_unknown_held" },
  { ten: "baoCaoKhongRoTuHang", nguon: "T4 (MOI), A1-36", lyDo: "báo cáo không rõ của đoạn edge chết từ hàng + sổ (edgeResumeStateOf, chữ hàng) ⇒ dấu + URGENT" },
  { ten: "priorStepsOf", nguon: "T4 (MOI), A1-2", lyDo: "settled / attempted từ hàng (laHangChuaRa: chữ FOE_STOP_NOT_SENT) ⇒ bước đã xong hay phải gửi lại" },
  // T4 bước 3 (HST 14/11, mục 4) — hàm thuần tách từ held(): đọc chữ hàng qua stopChuaRaTuHang (nợ STOP) ⇒ U / C / N / S / dấu cần người
  { ten: "quyetDinhKetDoanEdge", nguon: "T4 bước 3 (MOI), A1-3", lyDo: "quyết định cuối đoạn edge: nợ STOP đọc từ chữ hàng (stopChuaRaTuHang) ⇒ URGENT stopNotSent / chốt / dấu cần người" },
];
const TEN_TRUNG_GIAN = new Set(HAM_TRUNG_GIAN.map((h) => h.ten));

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bộ quét AST
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChoKhop {
  tep: string;
  ham: string;
  dang: string;
  chu: string;
  dong: number; // CHỈ để báo, không thuộc khoá
}

/** Giá trị `const` cấp tệp (theo tên) của mọi tệp trong phạm vi: dùng để giải định danh ở L2. */
export type BangHang = Map<string, ts.Expression[]>;

export function gomHang(nguon: ReadonlyArray<{ tep: string; src: string }>): BangHang {
  const bang: BangHang = new Map();
  for (const { tep, src } of nguon) {
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const ds = bang.get(d.name.text) ?? [];
        ds.push(d.initializer);
        bang.set(d.name.text, ds);
      }
    }
  }
  return bang;
}

const boc = (e: ts.Expression): ts.Expression => {
  let x = e;
  for (;;) {
    if (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
    else return x;
  }
};

/** I3: tên của ĐỐI TƯỢNG lỗi; bị ép thành chuỗi thì là chữ lỗi. */
const TEN_DOI_TUONG_LOI = new Set(["e", "err", "error"]);
/** Dấu trong kết quả của `dinhDanhCuoi`: một đối tượng lỗi bị ép thành chuỗi (I3). `laTenChu` / `laTenChuTuDo` coi là tên chữ. */
const DAU_EP_CHUOI = "(loi-ep-chuoi)";
/** Định danh là biến của một `catch (x)` bao quanh. */
function laBienCatch(id: ts.Identifier): boolean {
  for (let c: ts.Node | undefined = id.parent; c; c = c.parent) {
    if (ts.isCatchClause(c) && c.variableDeclaration && ts.isIdentifier(c.variableDeclaration.name) && c.variableDeclaration.name.text === id.text) return true;
  }
  return false;
}

/**
 * Định danh cuối của một biểu thức (bóc ngoặc, `!`, `as`, String(x), ??, ||, ?:, phép biến chữ).
 * T2 lượt sửa 1 (I3): template `${…}` và phép `+` gộp định danh cuối của mọi phần; một đối tượng lỗi (`e`/`err`/`error`, hoặc biến của
 * `catch` bao quanh) bị ÉP thành chuỗi (`String(e)`, `e.toString()`, `${e}`, `e + ""`) thì thêm `DAU_EP_CHUOI`.
 */
export function dinhDanhCuoi(e0: ts.Expression, epChuoi = false): string[] {
  const e = boc(e0);
  if (ts.isIdentifier(e)) return epChuoi && (TEN_DOI_TUONG_LOI.has(e.text) || laBienCatch(e)) ? [e.text, DAU_EP_CHUOI] : [e.text];
  if (ts.isPropertyAccessExpression(e)) return [e.name.text];
  if (ts.isElementAccessExpression(e)) return ts.isStringLiteralLike(e.argumentExpression) ? [e.argumentExpression.text] : [];
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...dinhDanhCuoi(e.left, epChuoi), ...dinhDanhCuoi(e.right, epChuoi)];
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...dinhDanhCuoi(e.left, true), ...dinhDanhCuoi(e.right, true)];
  if (ts.isTemplateExpression(e)) return e.templateSpans.flatMap((sp) => dinhDanhCuoi(sp.expression, true));
  if (ts.isConditionalExpression(e)) return [...dinhDanhCuoi(e.whenTrue, epChuoi), ...dinhDanhCuoi(e.whenFalse, epChuoi)];
  if (ts.isCallExpression(e)) {
    const c = boc(e.expression);
    if (ts.isPropertyAccessExpression(c) && PHEP_BIEN_CHU.has(c.name.text)) return dinhDanhCuoi(c.expression, epChuoi || c.name.text === "toString");
    if (ts.isIdentifier(c) && c.text === "String" && e.arguments[0]) return dinhDanhCuoi(e.arguments[0], true);
    if (ts.isIdentifier(c)) return [c.text];
    if (ts.isPropertyAccessExpression(c)) return [c.name.text];
  }
  return [];
}

const khopCap = (e: ts.Expression, tep: string): boolean => CAP_DINH_DANH.some((c) => c.tep === tep && c.dinhDanh === vanBanDich(e) && c.ham === hamBao(e));
const apTrenChu = (e: ts.Expression | undefined, tep: string): boolean => !!e && (dinhDanhCuoi(e).some(laTenChu) || khopCap(e, tep));
/** I2: đích là chữ TỰ DO (không gồm `reason`, `detail`: hai tên này phần lớn là mã có cấu trúc). */
const apTrenChuTuDo = (e: ts.Expression | undefined, tep: string): boolean => !!e && (dinhDanhCuoi(e).some(laTenChuTuDo) || khopCap(e, tep));
const laChuLiteral = (e: ts.Expression): boolean => {
  const x = boc(e);
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateExpression(x);
};

const coTienTo = (s: string): boolean => {
  const t = s.trimStart();
  return TIEN_TO_HANG.some((p) => t.startsWith(p));
};
const regexCoTienTo = (re: string): boolean => /FOE_|EDGE_|\[\[A2N/.test(re.replace(/\\\[/g, "["));

/** L2: biểu thức có phải hằng chữ trạng thái (giải định danh qua bảng hằng, chống vòng). */
export function laHangTienTo(e0: ts.Expression, bang: BangHang, dangGiai: Set<string> = new Set()): boolean {
  const e = boc(e0);
  if (ts.isStringLiteralLike(e)) return coTienTo(e.text);
  if (ts.isRegularExpressionLiteral(e)) return regexCoTienTo(e.text);
  if (ts.isTemplateExpression(e)) {
    if (coTienTo(e.head.text)) return true;
    return e.head.text.trim() === "" && e.templateSpans.length > 0 && laHangTienTo(e.templateSpans[0].expression, bang, dangGiai);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return laHangTienTo(e.left, bang, dangGiai);
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => ts.isExpression(x) && laHangTienTo(x, bang, dangGiai));
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "RegExp" && e.arguments?.[0]) {
    return laHangTienTo(e.arguments[0], bang, dangGiai);
  }
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
    const ten = ts.isIdentifier(e) ? e.text : e.name.text;
    const ds = bang.get(ten);
    if (ds && !dangGiai.has(ten)) {
      dangGiai.add(ten);
      const r = ds.some((x) => laHangTienTo(x, bang, dangGiai));
      dangGiai.delete(ten);
      return r;
    }
    // Tên `FOE_*`/`EDGE_*` không giải được: chỉ tính khi là định danh TRẦN (hằng nhập từ ngoài). Thuộc tính (`process.env.FOE_ENABLED`,
    // `env.EDGE_RUNTIME_ENABLED`) là tên biến môi trường, không phải hằng chữ trạng thái.
    return !ds && ts.isIdentifier(e) && TEN_HANG_TIEN_TO.test(ten);
  }
  return false;
}

const laNutJsDoc = (k: ts.SyntaxKind): boolean => k >= ts.SyntaxKind.FirstJSDocNode && k <= ts.SyntaxKind.LastJSDocNode;
const TEN_TRAN = /^[A-Za-z_$][\w$]*$/;

/**
 * T2 lượt sửa 1 (I1, m6) — đoạn chữ của khoá dựng từ AST, KHÔNG từ chữ nguồn thô, để `npm run format` (prettier của repo) và chú thích không
 * đổi khoá: chỉ gồm định danh, giá trị literal (chuỗi in lại bằng JSON ⇒ kiểu nháy / cách thoát không đổi khoá; số in theo giá trị), token.
 * Bỏ: chú thích và JSDoc (trivia), ngoặc nhóm (prettier thêm / bớt), dấu `;` (ASI), dấu phẩy treo, nháy của khoá object (`quoteProps`).
 * Arrow luôn in tham số trong ngoặc (`arrowParens: "avoid"` không đổi khoá). Tối đa 240 ký tự.
 */
export function chuAst(n: ts.Node, sf: ts.SourceFile): string {
  const out: string[] = [];
  const vao = (x: ts.Node): void => {
    if (laNutJsDoc(x.kind) || x.kind === ts.SyntaxKind.SemicolonToken) return;
    if (ts.isParenthesizedExpression(x)) return vao(x.expression);
    if (ts.isIdentifier(x) || ts.isPrivateIdentifier(x)) return void out.push(x.text);
    if (ts.isStringLiteral(x)) {
      const laKhoaTran = (ts.isPropertyAssignment(x.parent) || ts.isPropertyDeclaration(x.parent) || ts.isMethodDeclaration(x.parent)) && x.parent.name === x && TEN_TRAN.test(x.text);
      return void out.push(laKhoaTran ? x.text : JSON.stringify(x.text));
    }
    if (ts.isNoSubstitutionTemplateLiteral(x)) return void out.push(`\`${x.text}\``);
    if (ts.isTemplateExpression(x)) {
      out.push(`\`${x.head.text}`);
      for (const sp of x.templateSpans) {
        out.push("${");
        vao(sp.expression);
        out.push(`}${sp.literal.text}`);
      }
      return void out.push("`");
    }
    if (ts.isNumericLiteral(x)) return void out.push(String(Number(x.text.replace(/_/g, ""))));
    if (ts.isBigIntLiteral(x) || ts.isRegularExpressionLiteral(x)) return void out.push(x.text);
    if (ts.isArrowFunction(x)) {
      out.push("(");
      x.parameters.forEach((p, i) => {
        if (i > 0) out.push(",");
        vao(p);
      });
      out.push(")=>");
      return vao(x.body);
    }
    const con = x.getChildren(sf);
    if (con.length === 0) return void out.push(ts.tokenToString(x.kind) ?? x.getText(sf));
    for (const c of con) vao(c);
  };
  vao(n);
  return out.join("").replace(/,([)\]}])/g, "$1").slice(0, 240);
}

/** Tên hàm bao gần nhất có tên (lớp.phương thức khi là phương thức); hàm vô danh (callback) thì lấy hàm ngoài. */
export function hamBao(n: ts.Node): string {
  for (let c: ts.Node | undefined = n.parent; c; c = c.parent) {
    let ten: string | undefined;
    if (ts.isFunctionDeclaration(c) && c.name) ten = c.name.text;
    else if ((ts.isMethodDeclaration(c) || ts.isGetAccessorDeclaration(c) || ts.isSetAccessorDeclaration(c)) && ts.isIdentifier(c.name)) ten = c.name.text;
    else if (ts.isConstructorDeclaration(c)) ten = "constructor";
    else if (ts.isFunctionExpression(c) || ts.isArrowFunction(c)) {
      if (ts.isFunctionExpression(c) && c.name) ten = c.name.text;
      else if (ts.isVariableDeclaration(c.parent) && ts.isIdentifier(c.parent.name)) ten = c.parent.name.text;
      else if ((ts.isPropertyAssignment(c.parent) || ts.isPropertyDeclaration(c.parent)) && ts.isIdentifier(c.parent.name)) ten = c.parent.name.text;
    }
    if (ten === undefined) continue;
    for (let k: ts.Node | undefined = c.parent; k; k = k.parent) {
      if ((ts.isClassDeclaration(k) || ts.isClassExpression(k)) && k.name) return `${k.name.text}.${ten}`;
      if (ts.isFunctionLike(k)) break;
    }
    return ten;
  }
  return "(cap-tep)";
}

const laKhaiBaoHoacImport = (id: ts.Identifier): boolean => {
  const p = id.parent;
  if ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name === id) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  // `typeof ten` / `Parameters<typeof ten>` trong vị trí KIỂU: không chạy, không phải nơi gọi.
  for (let c: ts.Node | undefined = p; c; c = c.parent) {
    if (ts.isTypeNode(c)) return true;
    if (ts.isExpression(c) || ts.isStatement(c)) break;
  }
  return false;
};

/** I2: phép THÀNH VIÊN có ĐỐI SỐ là chữ tự do (`X.includes(err.message)`, `set.has(msg)`, `arr.indexOf(msg)`). */
const PHEP_THANH_VIEN = new Set(["includes", "has", "indexOf"]);
const PHEP_BANG = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

/** Bí danh import của hàm trung gian trong MỘT tệp (`import { chotTuHang as chot }` ⇒ `chot` → `chotTuHang`; Minor m1). */
export function biDanhTrungGian(sf: ts.SourceFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const el of st.importClause.namedBindings.elements) {
      if (el.propertyName && ts.isIdentifier(el.propertyName) && TEN_TRUNG_GIAN.has(el.propertyName.text) && el.name.text !== el.propertyName.text) m.set(el.name.text, el.propertyName.text);
    }
  }
  return m;
}

/** Quét một tệp nguồn theo các luật L1, L1-CẶP, L1-BẰNG (I2), L2, L3. Đoạn chữ của khoá dựng bằng `chuAst`. */
export function quet(src: string, tep: string, bang: BangHang): ChoKhop[] {
  const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
  const out: ChoKhop[] = [];
  const biDanh = biDanhTrungGian(sf);
  const dong = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const them = (n: ts.Node, dang: string, chu: string): void => {
    out.push({ tep, ham: hamBao(n), dang, chu, dong: dong(n) });
  };
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const c = boc(n.expression);
      if (ts.isPropertyAccessExpression(c)) {
        const op = c.name.text;
        const nhan = c.expression;
        if (op === "parse" && ts.isIdentifier(boc(nhan)) && (boc(nhan) as ts.Identifier).text === "JSON") {
          if (apTrenChu(n.arguments[0], tep)) them(n, "JSON.parse", chuAst(n, sf));
        } else if (PHEP_TREN_NHAN.has(op) || PHEP_THANH_VIEN.has(op)) {
          const l1 = PHEP_TREN_NHAN.has(op) && apTrenChu(nhan, tep);
          const l2 = PHEP_TREN_NHAN.has(op) && (n.arguments.some((a) => laHangTienTo(a, bang)) || (ts.isArrayLiteralExpression(boc(nhan)) && laHangTienTo(nhan, bang)));
          const thanhVien = PHEP_THANH_VIEN.has(op) && apTrenChuTuDo(n.arguments[0], tep); // I2
          if (l1 || l2 || thanhVien) them(n, `.${op}`, chuAst(n, sf));
        } else if (PHEP_TREN_DOI_SO.has(op)) {
          const l1 = apTrenChu(n.arguments[0], tep);
          const l2 = laHangTienTo(nhan, bang);
          if (l1 || l2) them(n, ts.isRegularExpressionLiteral(boc(nhan)) ? `/re/.${op}` : `re.${op}`, chuAst(n, sf));
        }
      }
    } else if (ts.isBinaryExpression(n)) {
      if (PHEP_BANG.has(n.operatorToken.kind)) {
        const l2 = laHangTienTo(n.left, bang) || laHangTienTo(n.right, bang);
        // I2: một vế là chữ tự do, vế kia là chuỗi / template literal; bỏ `typeof x === "string"`
        const coTypeof = ts.isTypeOfExpression(boc(n.left)) || ts.isTypeOfExpression(boc(n.right));
        const bangChu = !coTypeof && ((apTrenChuTuDo(n.left, tep) && laChuLiteral(n.right)) || (apTrenChuTuDo(n.right, tep) && laChuLiteral(n.left)));
        if (l2 || bangChu) them(n, n.operatorToken.getText(sf), chuAst(n, sf));
      }
    } else if (ts.isSwitchStatement(n)) {
      if (apTrenChuTuDo(n.expression, tep)) them(n, "switch", `switch(${chuAst(n.expression, sf)})`); // I2
    } else if (ts.isCaseClause(n)) {
      if (laHangTienTo(n.expression, bang)) them(n, "case", `case ${chuAst(n.expression, sf)}`);
    } else if (ts.isIdentifier(n) && (TEN_TRUNG_GIAN.has(n.text) || biDanh.has(n.text)) && !laKhaiBaoHoacImport(n)) {
      const goc = TEN_TRUNG_GIAN.has(n.text) ? n.text : (biDanh.get(n.text) as string);
      const p = n.parent;
      const laCallee = (ts.isCallExpression(p) && p.expression === n) || (ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p);
      const goi = ts.isCallExpression(p) && p.expression === n ? p : ts.isPropertyAccessExpression(p) && ts.isCallExpression(p.parent) ? p.parent : undefined;
      them(n, `goi:${goc}`, laCallee && goi ? chuAst(goi, sf) : `tham-chieu:${n.text}`);
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Danh sách đóng băng
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DongDongBang {
  tep: string;
  ham: string;
  dang: string;
  chu: string;
  /** Mã ô của bảng kiểm kê (A1-x, B-x, C-x, E-x, R-i/R-ii) hoặc MOI-x nếu bảng chưa có. */
  ma: string;
  lyDo: string;
  /** Chỉ còn cần cho tuyến complete/anomaly cũ (HST chọn phương án (B) ngày 14/11: giữ giao thức 2, thêm tuyến mới có cấu trúc). */
  /** T4 (HST + dieu-phoi 14/11) — `hien-thi`: chỉ phục vụ màn hình, không quyết an toàn (quyết định thật ở nơi khác, ghi trong lý do). */
  nhan?: "tuyen-cu-chi" | "hien-thi";
}

/**
 * Mã MOI (bảng chưa có ô; đề xuất cho scada-master ghi vào bảng). Không dòng MOI nào quyết STOP / run:
 *  MOI-1  edgeConfigCentral: `code` có cấu trúc + `detail` của anomaly cấu hình (bảng: mục "Đã xem", không mã) · MOI-2 tệp đệm cấu hình của nút
 *  MOI-3  releaseAlert: `code` kiểu literal · MOI-4 quiesceRobot: khoá chống lặp cảnh báo · MOI-5 retireEdgeNode: chữ audit (vùng auth)
 *  MOI-6  tệp đệm edgeRuntime · MOI-7 JSON chuẩn tắc của gói đã ký · MOI-8 biến môi trường JOIN_STATIC_PEERS · MOI-9 giá trị json OPC UA
 *  MOI-10 OPC UA nối lại một lần khi chứng chỉ chưa tin · MOI-11 che URL đăng nhập trong chữ lỗi · MOI-12 tệp đánh dấu motion-lock
 *  MOI-13 nghiaVuKetThucNguoi: chữ hàng chỉ để ghi audit · MOI-14 edgeStreams warnOnce: chỉ log (bảng: Đã xem) · MOI-15 robotStopAuth: vùng auth (bảng: Đã xem)
 *  MOI-16 packml: chuỗi ⇒ enum theo danh sách trắng · MOI-17 robotCommandDispatcher: chọn câu khi từ chối chuyển động · MOI-18 tuỳ chọn bảo mật OPC UA rỗng
 *  Bảng DK2 (hướng rơi, đường STOP / chuyển động, ca giữ) của mọi dòng MOI: `thuc-thiT2ao-cao.md`, mục "Lượt sửa 1".
 */
const DONG_BANG: readonly DongDongBang[] = [
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "===", chu: "rec.code===EDGE_JOURNAL_STALL_RECOVERED_CODE", ma: "MOI-1", lyDo: "so `code` có cấu trúc của anomaly nút để chọn loại cảnh báo cấu hình (bảng: mục Đã xem, edgeConfigCentral)" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "!==", chu: "rec.code!==\"EDGE_SAFETY_CONFIG_MISSING\"", ma: "MOI-1", lyDo: "như trên: `code` có cấu trúc, chọn cảnh báo PLC an toàn thiếu cấu hình" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "/re/.exec", chu: "/signed safety-PLC config\\(s\\) ([#0-9, ]+)/.exec(detail)", ma: "MOI-1", lyDo: "bảng Đã xem edgeConfigCentral.ts:235: id cấu hình trong detail chỉ chọn khoá chống trùng + câu URGENT" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertJournalStallRecovered", dang: "/re/.exec", chu: "/since (\\d+)/.exec(detail)", ma: "MOI-1", lyDo: "bảng Đã xem :272: `since` trong detail chỉ chọn khoá chống trùng của URGENT" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertJournalStallRecovered", dang: "/re/.test", chu: "/healthy=false/.test(detail)", ma: "MOI-1", lyDo: "bảng Đã xem :273: `healthy=` trong detail chỉ chọn câu URGENT (nút còn từ chối việc không phải STOP)" },
  { tep: "server/services/edge/edgeConfigSource.ts", ham: "openEdgeConfigCache", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "MOI-2", lyDo: "đọc tệp đệm cấu hình do chính nút ghi (phong bì AES-GCM có thẻ xác thực); hỏng ⇒ ném cache_format" },
  { tep: "server/services/edge/edgeCoordinator.ts", ham: "lyDoDongBoKhoa", dang: "goi:chotTuHang", chu: "chotTuHang(hang)", ma: "B-5", lyDo: "lyDoDongBoKhoa: chốt từ chữ hàng ⇒ từ chối syncRunResult/assignRun" },
  { tep: "server/services/edge/edgeCoordinator.ts", ham: "lyDoDongBoKhoa", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(hang,ctxasRecord<string,unknown>|null)", ma: "B-5", lyDo: "lyDoDongBoKhoa: nợ STOP từ chữ hàng ⇒ từ chối đồng bộ" },
  { tep: "server/services/edge/edgeGatewayRuntime.ts", ham: "releaseAlert", dang: "!==", chu: "code!==\"EDGE_DEVICE_RELEASED\"", ma: "MOI-3", lyDo: "`code` là kiểu hợp literal của chính hàm; chỉ chọn có in console.error" },
  { tep: "server/services/edge/edgeGatewayRuntime.ts", ham: "quiesceRobot", dang: ".split", chu: "d.reason??\"?\".split(\":\")", ma: "MOI-4", lyDo: "mã lý do detach (có cấu trúc) ⇒ khoá chống lặp cảnh báo attach; không quyết STOP" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "parseLine", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "E-8", lyDo: "dòng journal JSONL do chính nút ghi; hỏng ⇒ JournalCorrupt (ném)" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "EdgeJournal.restore", dang: ".split", chu: "text.split(\"\\n\")", ma: "E-8", lyDo: "tách dòng tệp journal của nút; dòng hỏng ⇒ JournalCorrupt" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "EdgeJournal.countUnreported", dang: ".split", chu: "text.split(\"\\n\")", ma: "E-10", lyDo: "như E-8: đếm bản ghi chưa báo từ tệp journal của nút" },
  { tep: "server/services/edge/edgeNodeCommands.ts", ham: "canhBaoStopRunQuaHan", dang: "goi:chotTuHang", chu: "F.chotTuHang(hang,ctx.foeResumeStateasnever)", ma: "B-6", lyDo: "X-14 :het: chốt từ chữ hàng ⇒ KHÔNG phát chữ 'Nothing sends it any more' khi lần bấm còn gửi được (đọc như resendAbortStops); đọc sai chỉ làm im một cảnh báo :het, không gửi hay chặn STOP nào (QUYET_DINH_MOC lần 5, X-14/1)" },
  { tep: "server/services/edge/edgeNodeCredentials.ts", ham: "retireEdgeNode", dang: ".replace", chu: "String(causeasError?.message??cause).replace(/^edge_nodes: /,\"\")", ma: "MOI-5", lyDo: "vùng auth: chỉ bỏ tiền tố chữ của DB guard để ghi audit; quyết định do isEdgeControlRefusal (mã)" },
  { tep: "server/services/edge/edgeProgramReportRule.ts", ham: "edgeHoldMarkOf", dang: "/re/.exec", chu: "/^EDGE_HELD\\([A-Za-z]+\\): ([A-Z_]+):/.exec(error??\"\")", ma: "A1-25", lyDo: "dấu EDGE_HELD(x): MARK: trong chữ end của nút ⇒ lời khuyên Continue/Abort", nhan: "tuyen-cu-chi" },
  { tep: "server/services/edge/edgeReportsCentral.ts", ham: "coTheDaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({status:st,detail:r.detail})", ma: "A1-21", lyDo: "bảng Đã xem edgeReportsCentral.ts:258: maTuChoiCua chỉ nhận status + detail.reason (có cấu trúc)" },
  { tep: "server/services/edge/edgeReportsCentral.ts", ham: "reportForNode", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(cu)", ma: "A1-11", lyDo: "hàng bước của nút: giữ chữ trạng thái C của trung tâm (laHangChuaRa trên cu.error)" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.upsertStep", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(patch.error)", ma: "A1-18", lyDo: "upsertStep của nút: mã không rõ trong chữ lỗi walker ⇒ daChot phía nút" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.baoCaoKetQua", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({status,detail:result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "bảng Đã xem edgeRunStore.ts:406: maTuChoiCua chỉ nhận status + detail (có cấu trúc)" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.ketCucKhongRo", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(detail)", ma: "A1-28", lyDo: "nút đọc lại detail do chính nó soạn (chiTietAnomalyKhongRo) để giữ bản có cấu trúc cho rider" },
  { tep: "server/services/edge/edgeRuntime.ts", ham: "restoreBuffer", dang: ".split", chu: "raw.split(\"\\n\")", ma: "MOI-6", lyDo: "đọc tệp đệm của nút (JSONL do chính nút ghi); không quyết STOP/run" },
  { tep: "server/services/edge/edgeSigning.ts", ham: "parseEdgeCanonicalJson", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "MOI-7", lyDo: "parse JSON chuẩn tắc của gói đã ký (kiểm chữ ký), có cấu trúc; hỏng ⇒ ném" },
  { tep: "server/services/edge/joinWizardService.ts", ham: "parseStaticPeers", dang: ".split", chu: "raw.split(\",\")", ma: "MOI-8", lyDo: "parse biến môi trường JOIN_STATIC_PEERS (cấu hình), không phải trạng thái an toàn" },
  { tep: "server/services/equipment/alarmNormalizer.ts", ham: "buildAndonInput", dang: "goi:standardCodeToReason", chu: "standardCodeToReason(normalized.standardCode)", ma: "A1-40", lyDo: "từ khoá trong mã báo động ⇒ loại Andon safety/maintenance" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(r.error)", ma: "A1-7", lyDo: "loadCompletedSteps (stopCoTheRa): [MA] ở đuôi chữ hàng ⇒ 'có thể đã ra' hay không" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-7", lyDo: "loadCompletedSteps: hàng trạng thái C (vế chữ qua laHangMaChuaRa) ⇒ dùng câu trả lời dispatcher" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-7", lyDo: "loadCompletedSteps: hàng trạng thái C ⇒ đưa vào stopCoTheRa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "A1-14", lyDo: "loadCompletedSteps: chốt run từ mã trong chữ hàng (khongRoChotHang)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(rs.error)", ma: "A1-13", lyDo: "execStep (:1024 ở 2500736bc): FOE_NOT_SENT_RUN_LATCHED: ⇒ STOP pass gửi bước bị từ chối" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(rs.error)", ma: "A1-13", lyDo: "execStep (:1042 ở 2500736bc): chưa gửi có chứng minh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(rs.error)", ma: "A1-15", lyDo: "execStep (:1029 ở 2500736bc): cờ khongRo từ chữ resume ⇒ bù trừ qua n3" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: ".includes", chu: "e.includes(`${FOE_NOT_SENT_RUN_LATCHED}:`)", ma: "A1-20", lyDo: "laLoiCuaKhoa: mã trong chữ khối chứa ⇒ có lời cuối riêng hay đi vào khối" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: ".includes", chu: "e.includes(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-20", lyDo: "như trên, mã FOE_STOP_NOT_SENT" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(e)", ma: "A1-20", lyDo: "như trên, mã không rõ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loiRieng", dang: "goi:laLoiCuaKhoa", chu: "laLoiCuaKhoa(resumeStateOf(rc,s.id)?.error)", ma: "A1-20", lyDo: "loiRieng: đọc chữ resume state của khối chứa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loiRieng", dang: "goi:laLoiCuaKhoa", chu: "laLoiCuaKhoa(r.error)", ma: "A1-20", lyDo: "loiRieng: đọc chữ hàng của khối chứa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "guiStopSauChot", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(hangNo?.error)", ma: "A1-7", lyDo: "nhánh plan.notPinned (:1670-1676 ở 2500736bc): [MA] của hàng nợ ⇒ 'có thể đã ra'" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viTuKetQuaHang", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r?.error??null,status:typeofkq.status===\"string\"?kq.status:null,detail:kq.detail??nullas{reason?:unknown}|null})", ma: "A1-21", lyDo: "viTuKetQuaHang (:1813 ở 2500736bc): tuChoi/driverLoi từ mã đầu chữ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "giuStopChuaRa", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(src?.hang??[].find((r)=>r.stepId===id)?.error)", ma: "A1-8", lyDo: "giuStopChuaRa: [MA] của hàng ⇒ chữ lỗi run và URGENT khi còn nợ STOP" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "nghiaVuKetThucNguoi", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "MOI-13", lyDo: "nghiaVuKetThucNguoi: mã không rõ trong chữ hàng chỉ để ghi danh sách vào audit, không quyết định" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "nghiaVuKetThucNguoi", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(r.error)", ma: "MOI-13", lyDo: "nghiaVuKetThucNguoi: tiền tố FOE_NOT_SENT_RUN_LATCHED chỉ để ghi forwardDropped vào audit" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "baoKetCucKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(a.error)", ma: "A1-30", lyDo: "baoKetCucKhongRo (`biet`): chọn chữ URGENT known/unknown" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "ketCucLenhFoe", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua(result)", ma: "A1-32", lyDo: "ketCucLenhFoe: mã 'có thể đã bay' (đọc cả error robot) ⇒ chống gửi lại" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execCommandMot", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:auth.error})", ma: "A1-21", lyDo: "execCommandMot (:3230 ở 2500736bc): mã từ chối của /authorize" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execCommandMot", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:result.error,status:result.status,detail:result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "execCommandMot (:3337 ở 2500736bc): tuChoi/driverLoi của kết quả lệnh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resumeRun", dang: "goi:chotTuHang", chu: "chotTuHang(awaitreadRunStepRows(runId)??[]asParameters<typeofchotTuHang>[0])", ma: "B-4", lyDo: "resumeRun: hệ thống từ chối (QT pump) không kết thúc run đã chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resumeRun", dang: "goi:chotTuHang", chu: "chotTuHang(derivedRows,resume)", ma: "A1-14", lyDo: "resumeRun: chốt vượt biên đoạn ở mỗi lần trao lại (chotTuHang trên hàng suy ra)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resendAbortStops", dang: "goi:chotTuHang", chu: "chotTuHang(hang)", ma: "B-6", lyDo: "resendAbortStops (`biet`): chốt từ chữ hàng ⇒ gửi lại STOP còn nợ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resendAbortStops", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(hang??[],ctxRun)", ma: "B-6", lyDo: "resendAbortStops: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error})", ma: "A1-21", lyDo: "viAbortChuaRa (:6543-6545 ở 2500736bc): tuChoi/driverLoi của STOP Abort" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error})", ma: "A1-21", lyDo: "như trên" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.result.error,status:r.result.status,detail:r.result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "như trên, kết quả lệnh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: ".startsWith", chu: "String(r.error??\"\").startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-10", lyDo: "noSauAbortKhoa (:6603 ở 2500736bc): hàng abort: failed có tiền tố FOE_STOP_NOT_SENT ⇒ URGENT" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error,status:typeofkq.status===\"string\"?kq.status:null,detail:kq.detail??nullas{reason?:unknown}|null})", ma: "A1-21", lyDo: "noSauAbortKhoa (:6606 ở 2500736bc): tuChoi/driverLoi" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-9", lyDo: "noSauAbortKhoa (:6624 ở 2500736bc): hàng trạng thái C ⇒ báo nợ STOP" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noKetThucKhongQuet", dang: "goi:chotTuHang", chu: "chotTuHang(src?.hang??[]asParameters<typeofchotTuHang>[0])", ma: "B-8", lyDo: "noKetThucKhongQuet: chốt từ chữ hàng ⇒ đường run chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:chotTuHang", chu: "chotTuHang(src?.hang??[]asParameters<typeofchotTuHang>[0])", ma: "B-9", lyDo: "runAbortStopSweep `khoa`: chốt từ chữ hàng ⇒ bộ lập kế hoạch run chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:chotTuHang", chu: "chotTuHang(src.hang??[]asParameters<typeofchotTuHang>[0])", ma: "B-10", lyDo: "runAbortStopSweep hoChuaKhoa: R-6-b khi không chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(src.hang??[],ctxRun)", ma: "A1-3", lyDo: "runAbortStopSweep noDaBen: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiLaKetCucKhongRo", dang: "re.test", chu: "RE_KHONG_RO.test(error)", ma: "A1-14", lyDo: "thân loiLaKetCucKhongRo: RE_KHONG_RO trên chữ (khớp theo từ ở bất kỳ đâu)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "maKetCucKhongRoCua", dang: "re.exec", chu: "RE_KHONG_RO.exec(error)", ma: "A1-29", lyDo: "maKetCucKhongRoCua: chỉ chọn mã hiển thị FOE/EDGE" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiCoMaKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-14", lyDo: "loiCoMaKhongRo (nơi soạn): không ghép mã hai lần" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "dauKetCucKhongRoCua", dang: "===", chu: "d.ma===\"EDGE_OUTCOME_UNKNOWN\"", ma: "E-28", lyDo: "dauKetCucKhongRoCua đọc `ma` CÓ CẤU TRÚC của ctx; lạ ⇒ FOE_OUTCOME_UNKNOWN (fail-closed)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buTruKhongRoCho", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(typeofe.error===\"string\"?e.error:null)", ma: "A1-16", lyDo: "buTruKhongRoCho: chữ lỗi trong resume state ⇒ kiểm n3" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "runDaChotKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(typeofe?.error===\"string\"?e.error:null)", ma: "A1-16", lyDo: "runDaChotKhongRo: chữ lỗi trong resume state ⇒ chốt" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "chotTuHang", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(x.error)", ma: "A1-14", lyDo: "thân chotTuHang: chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "xacNhanHetChot", dang: ".startsWith", chu: "r.error.startsWith(DAU_KHONG_GUI_CHOT)", ma: "A1-13", lyDo: "xacNhanHetChot (:287 ở 2500736bc): DAU_KHONG_GUI_CHOT ⇒ cần URGENT hay không" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "xacNhanHetChot", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-13", lyDo: "xacNhanHetChot (:290): hàng lệnh chưa final có mã không rõ ⇒ vẫn cần xác nhận" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buocCoTheDaBayTuHang", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-17", lyDo: "buocCoTheDaBayTuHang: mã không rõ ⇒ bước có thể đã bay" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "nhanBuocSauChot", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(x.error)", ma: "A1-17", lyDo: "nhanBuocSauChot (:332): không bao giờ gắn nhãn chưa gửi khi có mã" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "nhanBuocSauChot", dang: ".startsWith", chu: "x.error.startsWith(DAU_KHONG_GUI_CHOT)", ma: "A1-13", lyDo: "nhanBuocSauChot (:336): DAU_KHONG_GUI_CHOT ⇒ nhãn chuaGui" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buTruBiChanKhongRo", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "B-13", lyDo: "buTruBiChanKhongRo (/authorize): chốt từ chữ hàng ⇒ từ chối uỷ quyền bù trừ" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiGiuBuTruKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(stepError)", ma: "A1-19", lyDo: "loiGiuBuTruKhongRo (nơi SOẠN chữ held): mã trong chữ bước chỉ chọn câu (STOP thân)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiGiuBuTruKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(stepError)", ma: "A1-19", lyDo: "loiGiuBuTruKhongRo: như trên (m-K, lỗi đã biết không nói không rõ)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "maTuChoiCua", dang: "/re/.exec", chu: "/^[A-Z][A-Z0-9_]{2,63}(?=$|[:\\s(])/.exec(r.error??\"\")", ma: "A1-21", lyDo: "thân maTuChoiCua: mã đầu chữ lỗi khi detail.reason không phải mã" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "viChuaRaCuaLoi", dang: "/re/.exec", chu: "/(refused before a driver|may have gone out|nobody could decide it) \\[([A-Za-z0-9_]{1,64})\\]/.exec(String(error??\"\"))", ma: "A1-7", lyDo: "thân viChuaRaCuaLoi: [MA] ở đuôi chữ (dùng cả cho A1-8)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docAnomalyKhongRo", dang: "JSON.parse", chu: "JSON.parse(String(detail??\"\"))", ma: "A1-28", lyDo: "thân docAnomalyKhongRo: JSON trong detail của anomaly", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docAnomalyKhongRo", dang: "===", chu: "v.ma===\"EDGE_OUTCOME_UNKNOWN\"", ma: "A1-28", lyDo: "docAnomalyKhongRo: kiểm `ma` sau khi parse", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "canhBaoTuAnomalyEdge", dang: "!==", chu: "rec.code!==KHONG_RO_EDGE_ANOMALY", ma: "A1-28", lyDo: "canhBaoTuAnomalyEdge: `code` có cấu trúc của anomaly", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "canhBaoTuAnomalyEdge", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(rec.detail)", ma: "A1-28", lyDo: "canhBaoTuAnomalyEdge: detail anomaly ⇒ URGENT", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "ganBaoCaoKhongRoEdge", dang: ".startsWith", chu: "e.startsWith(DAU_DS_KHONG_RO_EDGE)", ma: "A1-24", lyDo: "ganBaoCaoKhongRoEdge (nút): giữ nguyên danh sách khi ghép rider", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".startsWith", chu: "error.startsWith(DAU_DS_KHONG_RO_EDGE)", ma: "A1-22", lyDo: "docDsKhongRoEdge: tiền tố EDGE_OUTCOME_UNKNOWN( trong chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".indexOf", chu: "error.indexOf(CUOI_DS_KHONG_RO_EDGE,DAU_DS_KHONG_RO_EDGE.length)", ma: "A1-22", lyDo: "docDsKhongRoEdge: dấu cuối danh sách", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".indexOf", chu: "error.indexOf(\")\",DAU_DS_KHONG_RO_EDGE.length)", ma: "A1-22", lyDo: "docDsKhongRoEdge: ')' cuối danh sách", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".split", chu: "error.slice(DAU_DS_KHONG_RO_EDGE.length,j>=0?j:k>=0?k:error.length).split(\",\")", ma: "A1-22", lyDo: "docDsKhongRoEdge: tách id theo ','", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: ".endsWith", chu: "error.endsWith(BAO_CAO_CUOI)", ma: "A1-24", lyDo: "tachBaoCaoKhongRoEdge: đuôi rider ]]", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: "JSON.parse", chu: "JSON.parse(error.slice(i+thieu?BAO_CAO_DAU_THIEU:BAO_CAO_DAU.length,-BAO_CAO_CUOI.length))", ma: "R-i", lyDo: "tachBaoCaoKhongRoEdge: JSON.parse rider sau lastIndexOf dấu ⇒ id STOP chứa dấu làm hỏng (R-i)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(JSON.stringify(x))", ma: "A1-24", lyDo: "tachBaoCaoKhongRoEdge: lọc báo cáo qua docAnomalyKhongRo", nhan: "tuyen-cu-chi" },
  // T4 (chu-du-an-HST 14/11, lần 2) — nơi SOẠN rider, không suy trạng thái: thoát dấu [[A2N trong JSON để dấu của nút là dấu duy nhất (R-i)
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "riderCua", dang: ".replace", chu: "JSON.stringify(bao).replace(/\\[\\[A2N/g,\"\\\\u005b[A2N\")", ma: "R-i", lyDo: "riderCua: soạn rider, thoát mọi [[A2N trong JSON (id có dấu rider) ⇒ tachBaoCaoKhongRoEdge chỉ thấy dấu của nút; không đọc chữ", nhan: "tuyen-cu-chi" },
  // T4 dạng 4, hướng (2) (chu-du-an-HST 14/11) — dòng do sửa: nợ STOP ở held() khi rider thiếu / không đọc được (tập "có thể đã đi" lấy từ sổ 0372, không từ chữ)
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetDoanEdge", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(v.hang,sauChot)", ma: "A1-3", lyDo: "quyetDinhKetDoanEdge (T4 bước 3, hàm thuần tách từ held(); rider đủ hay thiếu, R1): nợ STOP từ chữ hàng, đọc SAU khi đã chốt (I-1) ⇒ URGENT stopNotSent theo đúng khoá của rider / anomaly (fail-closed, không chặn STOP); cùng dòng, chuyển hàm, giữ 180", nhan: "tuyen-cu-chi" },
  // T4 bước 3 (HST 14/11, mục 4) — dòng lộ ra khi đưa quyetDinhKetDoanEdge vào HAM_TRUNG_GIAN (QUYET_DINH_MOC lần 4: 181)
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: "goi:quyetDinhKetDoanEdge", chu: "quyetDinhKetDoanEdge({runId,claimSeq:end.claimSeq,def:end.def,hang,so:au?{doc:\"duoc\",muc:au}:{doc:\"loi\"},stops,rider:riderThieu===true?\"thieu\":\"du\",bao:baoKhongRo,ctx:{...ctx,[OUTCOME_UNKNOWN_KEY]:[...prevUnknown,...unknown]}})", ma: "MOI-37", lyDo: "held: gọi hàm thuần quyết định cuối đoạn edge (đọc chữ hàng qua stopChuaRaTuHang, A1-3) ⇒ U / C / N / S / dấu cần người (tuyến cũ, giữ tới T1)", nhan: "tuyen-cu-chi" },
  // T4 (chu-du-an-HST 14/11, hướng (2): vá lỗ census) — dòng lộ ra khi đưa quyetDinhKetThucAnh và edgeResumeStateOf vào HAM_TRUNG_GIAN (mã MOI, ô gốc trong lý do)
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "quyetDinhKetThuc", dang: "goi:quyetDinhKetThucAnh", chu: "quyetDinhKetThucAnh(x,lyDo,hanMs)", ma: "MOI-19", lyDo: "cổng kết thúc của walker trung tâm (ảnh có sẵn), ô gốc A1-14 / A1-3: chốt / nợ STOP từ chữ hàng ⇒ held hoặc URGENT run_end; ĐÓNG (nợ ⇒ held)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "quyetDinhKetThuc", dang: "goi:quyetDinhKetThucAnh", chu: "quyetDinhKetThucAnh({runId:rc.runId,ctx:rc.context,owner:rc.runOwner,rows:src?.hang??null,def:rc.def,boNho:boNhoCua(rc),chiDoi:x.chiDoi},lyDo,hanMs)", ma: "MOI-20", lyDo: "cổng kết thúc của walker trung tâm (từ rc + hàng), ô gốc A1-14 / A1-3 / A1-8; hàng không đọc được ⇒ held; ĐÓNG" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "congCuoi", dang: "goi:quyetDinhKetThucAnh", chu: "quyetDinhKetThucAnh({runId,ctx,owner:run.startedBy??null,rows:hang,def:end.def,daCo,cachNo:cachNoEdge,viNo:viBao,chotTuBao:tuBao?{stepId:tuBao.stepId,ma:tuBao.ma}:null,claimSeq:end.claimSeq},\"edgeSegment\",undefined,KET_DOAN_EDGE_TONG_MS)", ma: "MOI-21", lyDo: "cổng kết thúc của đoạn edge ở trung tâm (T7 C1), ô gốc A1-14 / A1-3: nợ STOP hoặc chốt không có URGENT bền ⇒ held; ĐÓNG" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "edgeResumeStateFor", dang: "goi:edgeResumeStateOf", chu: "edgeResumeStateOf(def,rows,authorised,hintUnknown,stops)", ma: "MOI-22", lyDo: "trạng thái tiếp tục run edge khi Continue (hàng + sổ 0372 + hintUnknown), ô gốc B-2 / B-3a / A1-15: khongRo ⇒ không gửi lại, bù trừ cần người; ĐÓNG" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "getRun", dang: "goi:edgeResumeStateOf", chu: "edgeResumeStateOf(usable,stepRows,newSet())", ma: "MOI-23", lyDo: "getRun: CHỈ màn hình (khongRoCho cho Studio hỏi lý do); quyết định thật ở resumeRun (MOI-22, B-14); không quyết an toàn", nhan: "hien-thi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "daGuiTheo", dang: "goi:edgeResumeStateOf", chu: "edgeResumeStateOf(x.def,x.rows,uq,[],x.stops)", ma: "MOI-24", lyDo: "tapKhongRoEdge (A1-22): lệnh đã gửi theo hàng + sổ ⇒ tập không rõ cuối đoạn (HỢP, không bao giờ ít hơn chữ); ĐÓNG" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "baoCaoKhongRoTuHang", dang: "goi:edgeResumeStateOf", chu: "edgeResumeStateOf(def,rows,authorised,[],stops)", ma: "MOI-25", lyDo: "báo cáo không rõ từ hàng + sổ (đoạn edge chết, interruptedForNode, ô gốc A1-36): bù trừ cần người / URGENT; ĐÓNG" },
  // T4 (HST hướng (b), sau đối chiếu của kiem-dinh 14/11) — dòng lộ ra khi đưa buTruBiChanKhongRo, baoCaoKhongRoTuHang, priorStepsOf vào HAM_TRUNG_GIAN (mã MOI, ô gốc trong lý do)
  { tep: "server/services/edge/edgeAuthorizeCentral.ts", ham: "authorizeForNode", dang: "goi:buTruBiChanKhongRo", chu: "tham-chieu:buTruBiChanKhongRo", ma: "MOI-26", lyDo: "authorizeForNode (5b): lấy hàm từ import động (tham chiếu), quyết định ở dòng MOI-27" },
  { tep: "server/services/edge/edgeAuthorizeCentral.ts", ham: "authorizeForNode", dang: "goi:buTruBiChanKhongRo", chu: "buTruBiChanKhongRo(run.contextJsonasRecord<string,unknown>|null,hang,chu.step.id,chu.comp.id)", ma: "MOI-27", lyDo: "/authorize 5b: bù trừ KHÔNG phải STOP của run chốt (ngữ cảnh hoặc chotTuHang của hàng, ô gốc B-12 / A1-14) ⇒ từ chối outcome_unknown_held; STOP không tới đây (L-7). Kế thừa A1-14: hàng mất mã và ngữ cảnh mất chốt ⇒ không chặn" },
  { tep: "server/services/edge/edgeExecutionCentral.ts", ham: "interruptedForNode", dang: "goi:baoCaoKhongRoTuHang", chu: "baoCaoKhongRoTuHang(defKhongRo,hangBuoc,a.claimSeqasnumber,newSet(uyQuyen.filter((u)=>u.supersededAt==null).map((u)=>u.stepId)),stopIds)", ma: "MOI-28", lyDo: "đoạn edge chết (ô gốc A1-36, I-D): báo cáo + dấu held + URGENT từ hàng + sổ 0372; sổ đọc lỗi ⇒ 503, không ghi gì (ĐÓNG)" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.sweepSource", dang: "goi:priorStepsOf", chu: "priorStepsOf(rows)", ma: "MOI-29", lyDo: "quét STOP cục bộ của walker edge (ô gốc A1-2): hàng trạng thái C không settled ⇒ STOP gửi lại. Kế thừa A1-2: hàng mất mã ⇒ settled" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:priorStepsOf", chu: "priorStepsOf([])", ma: "MOI-30", lyDo: "loadCompletedSteps: không có DB ⇒ prior rỗng kèm unknown: true (tính là đã tác động, R-6-c; ĐÓNG)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:priorStepsOf", chu: "priorStepsOf(rows)", ma: "MOI-31", lyDo: "loadCompletedSteps: prior của walk trung tâm (ô gốc A1-2): settled / attempted từ hàng. Kế thừa A1-2" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "rcTuHang", dang: "goi:priorStepsOf", chu: "priorStepsOf(hang)", ma: "MOI-32", lyDo: "rcTuHang: ảnh của run chốt đã lưu cho bộ lập kế hoạch Abort (ô gốc A1-2). Kế thừa A1-2" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgePriorPictureOf", dang: "goi:priorStepsOf", chu: "priorStepsOf(rows)", ma: "MOI-33", lyDo: "ảnh prior gửi cho đoạn edge kế tiếp (settled / attempted, ô gốc A1-2); hàng không đọc được ⇒ unknown: true. Kế thừa A1-2" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "liveSweepSource", dang: "goi:priorStepsOf", chu: "priorStepsOf(rows)", ma: "MOI-34", lyDo: "nguồn quét Abort của walk sống (ô gốc A1-2). Kế thừa A1-2" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "storedSweepSource", dang: "goi:priorStepsOf", chu: "priorStepsOf([])", ma: "MOI-35", lyDo: "storedSweepSource: hàng không đọc được ⇒ prior rỗng, undecidable ⇒ STOP được gửi (R-6-c; ĐÓNG)" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "storedSweepSource", dang: "goi:priorStepsOf", chu: "priorStepsOf(rows)", ma: "MOI-36", lyDo: "nguồn quét Abort của run đã lưu (ô gốc A1-2). Kế thừa A1-2" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "priorStepsOf", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-2", lyDo: "priorStepsOf: hàng trạng thái C ⇒ không settled" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laLoiKhongGuiChot", dang: ".startsWith", chu: "error.startsWith(`${FOE_NOT_SENT_RUN_LATCHED}:`)", ma: "A1-13", lyDo: "thân laLoiKhongGuiChot: tiền tố FOE_NOT_SENT_RUN_LATCHED:" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangMaChuaRa", dang: ".startsWith", chu: "r.error.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-1", lyDo: "thân laHangMaChuaRa: tiền tố FOE_STOP_NOT_SENT: ⇒ nợ STOP" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangChuaRa", dang: "goi:laHangMaChuaRa", chu: "laHangMaChuaRa(r,id)", ma: "A1-1", lyDo: "laHangChuaRa: vế chữ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangChuaRa", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua({ok:false,detail:kq.detail??undefinedasRecord<string,unknown>|undefined})", ma: "A1-1", lyDo: "laHangChuaRa vế 2 (bảng Đã xem :412-416): chỉ resultJson.detail, có cấu trúc" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:chotTuHang", chu: "chotTuHang(rows??[])", ma: "B-12", lyDo: "stopChuaRaTuHang `khoa`: chốt từ chữ hàng ⇒ hàng bị từ chối / abort: failed là nợ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:laHangMaChuaRa", chu: "laHangMaChuaRa(r,id)", ma: "A1-3", lyDo: "stopChuaRaTuHang `coMa`: nợ STOP qua mã" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r,id)", ma: "A1-3", lyDo: "stopChuaRaTuHang: nợ STOP qua laHangChuaRa" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error,status:typeofkq.status===\"string\"?kq.status:null,detail})", ma: "A1-21", lyDo: "dauVetCuaHang (foeRunStore.ts:491 ở 2500736bc): tuChoi/driverLoi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua({ok:false,detail:detailasRecord<string,unknown>|undefined})", ma: "A1-4", lyDo: "dauVetCuaHang: 'có thể đã bay' (chỉ detail, có cấu trúc)" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r,id)", ma: "A1-4", lyDo: "dauVetCuaHang: hàng trạng thái C" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(r.error)", ma: "A1-13", lyDo: "dauVetCuaHang (:495 ở 2500736bc): chưa gửi có chứng minh" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "phanLoaiStopAbort", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(vao.hang,vao.ctx)", ma: "A1-3", lyDo: "phanLoaiStopAbort (A1-6) lấy nợ STOP qua stopChuaRaTuHang" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "A1-14", lyDo: "quyetDinhKetThucAnh: chốt từ chữ hàng ⇒ URGENT cuối run" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,x.ctx)", ma: "A1-3", lyDo: "quyetDinhKetThucAnh: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(rows.find((r)=>r.stepId===id0)?.error)", ma: "A1-8", lyDo: "quyetDinhKetThucAnh (:709 ở 2500736bc): [MA] ⇒ chữ nợ, VI_KHONG_BAO dự phòng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quetMotRun", dang: "goi:chotTuHang", chu: "chotTuHang(hang,ctx[RESUME_STATE_CTX_KEY]asParameters<typeofchotTuHang>[1])", ma: "A1-14", lyDo: "quetMotRun (quét URGENT run_end): chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "liveSweepSource", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,rc.context)", ma: "A1-3", lyDo: "liveSweepSource: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "storedSweepSource", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,context)", ma: "A1-3", lyDo: "storedSweepSource: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeOutcomeUnknownOf", dang: "goi:docDsKhongRoEdge", chu: "docDsKhongRoEdge(end.error,commands)", ma: "A1-22", lyDo: "edgeOutcomeUnknownOf (chỉ test gọi ở 27f9b47ac): danh sách từ chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "tapKhongRoEdge", dang: "goi:docDsKhongRoEdge", chu: "docDsKhongRoEdge(x.error,lenh)", ma: "A1-22", lyDo: "tapKhongRoEdge: vế chữ của HỢP (chữ ∪ hàng + sổ)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauKhongRoTuEdge", dang: "/re/.exec", chu: "/(?:command|step) \"([^\"]{1,128})\" (?:outcome unknown|failed; another command's outcome is unknown) — machine state unknown — compensation \"([^\"]{1,128})\"/.exec(end.error??\"\")", ma: "A1-19", lyDo: "dauKhongRoTuEdge: id bước/bù trừ của dấu held từ chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "themBuocHongKhiTiepTuc", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-15", lyDo: "themBuocHongKhiTiepTuc: cờ khongRo từ chữ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-25", lyDo: "heldAdvice: tiền tố FOE_STOP_NOT_SENT ⇒ lời khuyên Abort", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "goi:edgeHoldMarkOf", chu: "edgeHoldMarkOf(error)", ma: "A1-25", lyDo: "heldAdvice: dấu overrun/unused của nút", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "===", chu: "mark===EDGE_HOLD_CONSUME_OVERRUN", ma: "A1-25", lyDo: "heldAdvice: so dấu EDGE_HOLD_CONSUME_OVERRUN", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "===", chu: "mark===EDGE_HOLD_UNUSED_NOT_REPORTED", ma: "A1-25", lyDo: "heldAdvice: so dấu EDGE_HOLD_UNUSED_NOT_REPORTED", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "applyEdgeSegmentEnd", dang: "goi:tachBaoCaoKhongRoEdge", chu: "tachBaoCaoKhongRoEdge(endTho.error,(x)=>x.claimSeq===endTho.claimSeq&&baoCaoHopLe(endTho.def,x))", ma: "A1-24", lyDo: "applyEdgeSegmentEnd: tách rider khỏi chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "khongRoCuaDoan", dang: "goi:tapKhongRoEdge", chu: "tapKhongRoEdge({def:end.def,error:end.error,outcomeUnknown:end.outcomeUnknown,catDay:endTho.error?.length??0>=TRAN_LOI_EDGE,thieu:riderThieu===true,rows:hangKr,uyQuyen,stops})", ma: "B-1", lyDo: "khongRoCuaDoan: nguồn foeOutcomeUnknown của ctx (tapKhongRoEdge, vế chữ = A1-22)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-26", lyDo: "held (loiHien): tiền tố ⇒ chữ trung tâm hay chữ nút", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-27", lyDo: "held: tiền tố ⇒ dấu KET_CUC_KHONG_RO (Continue cần người)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: "goi:dauKhongRoTuEdge", chu: "dauKhongRoTuEdge(end,at,dauCu?baoKhongRo:[...baoKhongRo,...dauBu])", ma: "A1-19", lyDo: "held: dấu không rõ từ chữ end; T4 bước 3, R2 (a) (chủ dự án 14/11): cùng dòng, đối số thêm cặp lệnh / bù trừ của U (dauBu)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-15", lyDo: "edgeResumeStateOf (:2225 ở 2500736bc): cờ khongRo từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-15", lyDo: "edgeResumeStateOf (:2246): cờ khongRo từ chữ lỗi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(c?.error)", ma: "A1-15", lyDo: "edgeResumeStateOf: cờ khongRo từ chữ bù trừ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(error)", ma: "A1-13", lyDo: "edgeResumeStateOf (:2249): compensationHeld / doneFailed" },
  { tep: "server/services/orchestration/foe/workflowModel.ts", ham: "duyet", dang: ".includes", chu: "id.includes(DAU_HIEU_RIENG_STEP_ID)", ma: "SG-1", lyDo: "luật mã bước MỚI của main (kiemTraKyTuIdBuoc, hàm trong duyet; X-06): kiểm ĐẦU VÀO lúc deploy / nhân bản, từ chối id chứa dấu [[A2N; không suy trạng thái run hay STOP từ chữ, không gửi hay chặn STOP nào; id lọt qua thì rider bị đọc thiếu ⇒ fail-closed (QUYET_DINH_MOC lần 6, SG-1)" },
  { tep: "server/services/ot/commandDispatcher.ts", ham: "hangThietBi", dang: "goi:maTienTo", chu: "maTienTo(r.errorText)", ma: "A1-33", lyDo: "hangThietBi: mã đầu errorText ⇒ hàng thiết bị hay không gửi" },
  { tep: "server/services/ot/commandDispatcher.ts", ham: "ketQuaPhatLai", dang: "goi:maTienTo", chu: "maTienTo(existing.errorText)", ma: "A1-34", lyDo: "ketQuaPhatLai: reason phát lại từ mã đầu errorText" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.readOne", dang: "goi:laQuaHanThuVienEip", chu: "laQuaHanThuVienEip(err)", ma: "A1-37", lyDo: "readOne: chữ lỗi thư viện EIP ⇒ phiên nhiễm" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.writeOne", dang: "goi:laQuaHanThuVienEip", chu: "laQuaHanThuVienEip(err)", ma: "A1-37", lyDo: "writeOne: chữ lỗi thư viện EIP ⇒ phiên nhiễm" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.writeOne", dang: "goi:laQuaHanGhiEip", chu: "laQuaHanGhiEip(err)", ma: "A1-37", lyDo: "writeOne: chữ lỗi thư viện EIP ⇒ kết cục ghi không rõ" },
  { tep: "server/services/ot/drivers/opcuaAddress.ts", ham: "normalizeOpcuaValue", dang: "JSON.parse", chu: "JSON.parse(raw)", ma: "MOI-9", lyDo: "giá trị kiểu json của thẻ OPC UA (dữ liệu, không phải lỗi); hỏng ⇒ quality bad" },
  { tep: "server/services/ot/drivers/opcuaDriver.ts", ham: "OpcuaDriver.connect", dang: "/re/.test", chu: "/BadCertificateUntrusted|certificate verification fail/i.test(errasError?.message??\"\")", ma: "MOI-10", lyDo: "chữ lỗi node-opcua khi NỐI (chứng chỉ chưa tin) ⇒ quét lại trust-list, thử nối lại đúng một lần" },
  { tep: "server/services/robot/deviceOwnershipService.ts", ham: "errText", dang: ".replace", chu: "String(easError?.message??e).replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "che thông tin đăng nhập trong URL của chữ lỗi (hiển thị)" },
  { tep: "server/services/robot/robotCommandDispatcher.ts", ham: "safeDbError", dang: ".replace", chu: "raw.replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "như trên" },
  { tep: "server/services/robot/robotMotionLockStore.ts", ham: "errText", dang: ".replace", chu: "raw.replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "như trên" },
  { tep: "server/services/robot/robotMotionLockStore.ts", ham: "readLockPersistPending", dang: "JSON.parse", chu: "JSON.parse(raw)", ma: "MOI-12", lyDo: "tệp đánh dấu motion-lock do chính tiến trình ghi; hỏng ⇒ unreadable" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "decodeRobotMode", dang: ".includes", chu: "raw.includes(\"POWER_OFF\")", ma: "A1-39", lyDo: "decodeRobotMode: chữ dashboard UR ⇒ mode" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "UrsimBridgeDriver.getState", dang: "goi:decodeRobotMode", chu: "decodeRobotMode(modeReply)", ma: "A1-39", lyDo: "getState: mode robot UR từ chữ dashboard" },
  // lượt 2 (scada-master 14/11): `msg` + L1-CẶP
  { tep: "server/services/edge/edgeExecutionAgent.ts", ham: "EdgeExecutionAgent.pullOnce", dang: ".includes", chu: "r.outcome.includes(\"pending:\")", ma: "A1-41", lyDo: "outcome `pending:` (hằng của agent) ⇒ hoãn STOP sang pha làm việc" },
  { tep: "server/services/edge/edgeStreams.ts", ham: "EdgeStreamShipper.warnOnce", dang: ".includes", chu: "msg.includes(\"ANOMALY\")", ma: "MOI-14", lyDo: "bảng Đã xem edgeStreams.ts:272: chỉ chọn có ghi log hay không" },
  { tep: "server/services/ot/drivers/opcuaDriver.ts", ham: "OpcuaDriver.writeTags", dang: ".startsWith", chu: "msg.startsWith(OPCUA_TIEN_TO_QUA_HAN)", ma: "A1-35", lyDo: "chữ lỗi node-opcua `Transaction has timed out` ⇒ qua_han_driver (không rõ) hay failed" },
  { tep: "server/services/ot/drivers/opcuaSecurity.ts", ham: "explainOpcuaConnectError", dang: "/re/.test", chu: "/BadCertificateUntrusted|certificate verification failed/i.test(msg)", ma: "E-41", lyDo: "chỉ chọn câu giải thích lỗi kết nối (chứng chỉ chưa tin)" },
  { tep: "server/services/ot/drivers/opcuaSecurity.ts", ham: "explainOpcuaConnectError", dang: "/re/.test", chu: "/End ?point must exist|cannot find endpoint/i.test(msg)", ma: "E-40", lyDo: "chỉ chọn câu giải thích lỗi kết nối (endpoint None)" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: ".indexOf", chu: "frame.data.indexOf(\",\")", ma: "A1-38", lyDo: "id / kết quả trong khung TMSCT ⇒ ok / tm_reply_id_mismatch / tm_reply_unexpected" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "/re/.exec", chu: "/^OK((?:;\\d+)+)$/.exec(result)", ma: "A1-38", lyDo: "kết quả TMSCT `OK;…` ⇒ ok kèm cảnh báo" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "/re/.test", chu: "/^ERROR(;|$)/.test(result)", ma: "A1-38", lyDo: "kết quả TMSCT `ERROR` ⇒ tm_script_error" },
  { tep: "server/services/robot/robotStopAuth.ts", ham: "refusalAsTrpc", dang: "/re/.test", chu: "/MUST_CHANGE_PASSWORD/.test(msg)", ma: "MOI-15", lyDo: "bảng Đã xem robotStopAuth.ts:152: vùng auth, chỉ đổi mã lỗi tRPC" },
  { tep: "server/services/robot/ursim/ursimClient.ts", ham: "UrsimClient.isProgramRunning", dang: "/re/.test", chu: "/true/i.test(reply)", ma: "A1-39", lyDo: "`/true/i` trên chữ dashboard `running` ⇒ busy (lỗi không chứa true ⇒ rảnh)" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "UrsimBridgeDriver.getState", dang: "/re/.test", chu: "/EMERGENCY_STOP|PROTECTIVE_STOP/i.test(safety)", ma: "A1-39", lyDo: "chữ dashboard `safetystatus` ⇒ estop (chữ lạ hoặc ném ⇒ false)" },
  // lượt sửa 1 (I2–I4, HST 14/11): mẫu mở rộng lộ thêm 12 chỗ
  { tep: "server/services/edge/edgeStreams.ts", ham: "EdgeStreamShipper.warnOnce", dang: ".has", chu: "this.warned.has(`${k}|${msg}`)", ma: "MOI-14", lyDo: "khoá chống lặp log (cảnh báo một lần mỗi chữ); chỉ log" },
  { tep: "server/services/equipment/packml.ts", ham: "asPackmlCommand", dang: ".includes", chu: "PACKML_COMMANDSasreadonlystring[].includes(raw)", ma: "MOI-16", lyDo: "chuẩn hoá chuỗi về lệnh PackML theo danh sách trắng; lạ ⇒ null" },
  { tep: "server/services/equipment/packml.ts", ham: "asPackmlState", dang: ".includes", chu: "PACKML_STATESasreadonlystring[].includes(raw)", ma: "MOI-16", lyDo: "chuẩn hoá chuỗi về trạng thái PackML theo danh sách trắng; lạ ⇒ null (bảng D-10: không adapter nào hiện thực getState)" },
  { tep: "server/services/ot/commandDispatcher.ts", ham: "maTienTo", dang: "/re/.exec", chu: "/^([A-Z][A-Z0-9_]*):/.exec(errorText)", ma: "A1-33", lyDo: "thân maTienTo: mã đầu errorText ⇒ hàng thiết bị hay không gửi (I4)" },
  { tep: "server/services/ot/drivers/opcuaAddress.ts", ham: "toFiniteNumber", dang: "!==", chu: "raw.trim()!==\"\"", ma: "MOI-9", lyDo: "giá trị thẻ OPC UA: chuỗi rỗng không phải số ⇒ null" },
  { tep: "server/services/ot/drivers/opcuaSecurity.ts", ham: "pickCaseInsensitive", dang: "===", chu: "raw===\"\"", ma: "MOI-18", lyDo: "tuỳ chọn bảo mật OPC UA rỗng ⇒ chưa cấu hình (mặc định + cảnh báo một lần)" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "!==", chu: "frame.header!==\"TMSCT\"", ma: "A1-38", lyDo: "đầu khung TM khác TMSCT ⇒ tm_reply_unexpected (lỗi đã biết, không phải không rõ)" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "===", chu: "frame.header===\"CPERR\"", ma: "A1-38", lyDo: "đầu khung TM CPERR ⇒ tm_cperr" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "===", chu: "result===\"OK\"", ma: "A1-38", lyDo: "kết quả TMSCT `OK` ⇒ ok" },
  { tep: "server/services/robot/robotCommandDispatcher.ts", ham: "dispatchRobotJobCore", dang: "===", chu: "error===\"SAFETY_SIM_ONLY\"", ma: "MOI-17", lyDo: "`error` là mã của safetyPreflightReason (có cấu trúc); chỉ chọn câu ghi lại, hai nhánh đều TỪ CHỐI chuyển động" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "decodeRobotMode", dang: "===", chu: "raw===\"IDLE\"", ma: "A1-39", lyDo: "chữ dashboard UR `IDLE` ⇒ mode" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "decodeRobotMode", dang: "===", chu: "raw===\"RUNNING\"", ma: "A1-39", lyDo: "chữ dashboard UR `RUNNING` ⇒ mode" },
];

/**
 * HST 14/11 T2-DK3 (+ I5) — LỊCH SỬ MỐC. Census khẳng định: (1) `DONG_BANG.length === SO_DONG_MOC` (bằng đúng, không còn độ chùng);
 * (2) `LICH_SU_MOC` không tăng (mỗi phần tử ≤ phần tử trước); (3) phần tử cuối = `SO_DONG_MOC`; (4) phần tử đầu = `MOC_GOC` (ghim).
 * Hệ quả: thêm một dòng đóng băng thì phải nâng mốc, mà nâng mốc thì vi phạm "không tăng".
 * HST 14/11: mốc đặt lại sau khi mở rộng mẫu I2–I4, 148 → 160 (mở rộng tầm nhìn, không phải mã mới). Từ mốc này trở đi mới áp luật "chỉ giảm".
 * GIỚI HẠN: người sửa CÙNG LÚC các phần tử cũ của `LICH_SU_MOC` (hoặc `MOC_GOC`) và danh sách thì census không chặn được; phần đó cổng rà
 * phải bắt: mọi thay đổi `LICH_SU_MOC` / `MOC_GOC` cần số quyết định (QUYET_DINH_MOC) trong commit.
 * Mỗi bước của T1 bỏ dòng: xoá dòng, THÊM một phần tử mới (nhỏ hơn) vào cuối `LICH_SU_MOC`, hạ `SO_DONG_MOC` bằng nó, cùng commit.
 */
// T4 (chu-du-an-HST, 2026-11-14, lần 2) — mốc đặt lại 161: thêm dòng SOẠN rider ở riderCua (thoát dấu [[A2N, R-i, tuyen-cu-chi); ghim lại phần tử đầu, không ghi [160, 161].
// QUYET_DINH_MOC lần 3 (chu-du-an-HST, 2026-11-14): mốc LICH_SU_MOC = 180 = 161 + 1 (A1-3, held() dạng 4) + 7 (MOI-19…25) + 11 (MOI-26…36); số chạy thật của kiem-dinh trên
// df934d38e + dung-yen-b.patch. Ghim lại phần tử đầu. Từ đây chỉ được GIẢM.
// QUYET_DINH_MOC lần 4 (chu-du-an-HST, 2026-11-14): mốc LICH_SU_MOC = 181 = 180 + MOI-37 (held() gọi quyetDinhKetDoanEdge; hàm vào HAM_TRUNG_GIAN; A1-3, A1-19 chỉ đổi
// văn bản khoá do tách hàm thuần, bước 3); số chạy thật của kiem-dinh trên 5c335119a + 28307c87. Ghim lại phần tử đầu. Từ đây chỉ được GIẢM.
// QUYET_DINH_MOC lần 5 (chu-du-an-HST, 2026-11-17, uỷ quyền 17/11; mã X-14/1): mốc = 182 = 181 + 1 (canhBaoStopRunQuaHan gọi chotTuHang, B-6)
// QUYET_DINH_MOC lần 6 (chu-du-an-HST, 2026-11-18; mã SG-1, hàng X-22): mốc = 183 = 182 + 1 (luật mã bước của main gộp vào A2(n): workflowModel.ts duyet, id.includes(DAU_HIEU_RIENG_STEP_ID))
const MOC_GOC = 183;
const LICH_SU_MOC: readonly number[] = [183];
/** Mốc số dòng đóng băng: bằng phần tử cuối của `LICH_SU_MOC`, chỉ được GIẢM. */
const SO_DONG_MOC = 183;

/**
 * HST 14/11 T2-DK1 — "ngoài tầm" không được thành "ngoài sổ". 21 ô của bảng kiểm kê mà census KHÔNG bắt được (không có phép so chữ để bắt:
 * dữ liệu có cấu trúc, nơi SOẠN chữ, phép so trong SQL). Mỗi ô ghi ca test đang GIỮ ô đó; census đọc tệp test và tìm ĐÚNG chuỗi tên ca
 * (đối số đầu của `it(...)` / `test(...)`, không tính `it.skip`). Ca bị xoá / đổi tên ⇒ ĐỎ, thông báo nêu ô và ca.
 * Ca giữ chỉ ghi khi người làm T2 đã ĐỌC thân ca và thấy nó giữ đúng hướng rơi của ô; chưa chắc ⇒ ô vào `CHUA_CO_CA`.
 * Ghi chú: `CHUA_CO_CA` phải RỖNG trước khi A2(n) gộp.
 */
export const O_NGOAI_TAM: readonly { ma: string; viTri: string; ca: readonly { tep: string; ten: string }[] }[] = [
  { ma: "A1-5", viTri: "foeRunStore.ts:dauVetAbort (String(resultJson.stepId), có cấu trúc)", ca: [] },
  { ma: "A1-6", viTri: "foeRunStore.ts:phanLoaiStopAbort (`ab`, id có cấu trúc)", ca: [] },
  {
    ma: "A1-12",
    viTri: "edgeReportsCentral.ts:reportForNode (nơi SOẠN chữ abort_stop từ `vi`)",
    ca: [{ tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "T9F3D-ABORT-EDGE-KHONG-MA the one row of an unsent STOP ever written WITHOUT the code (edgeReportsCentral.ts: an edge's failed abort_stop with no closed value, 'STOP not confirmed by the edge node', since T5): owed on a latched run, a press's debt on any run" }],
  },
  { ma: "A1-23", viTri: "edgeRunStore.ts:segmentEndGoc (nơi SOẠN chữ end)", ca: [] },
  {
    ma: "A1-31",
    viTri: "robot/criticalStopAlert.ts:nguoiDaCoCanhBao (lọc trùng theo `message` trong SQL)",
    ca: [{ tep: "server/services/orchestration/foe/foeKhongRoUrgentTrung.a2n.test.ts", ten: "T9F3E-A131-VA-CHAM two STOP ids alike at both ends (the old cut: 'nt_dun…ai_01'): two different words, each naming its own id's hash" }],
  },
  { ma: "A1-36", viTri: "edgeExecutionCentral.ts:interruptedForNode (sổ 0372, có cấu trúc)", ca: [] },
  {
    ma: "B-2",
    viTri: "foeEngine.ts:resumeRun → edgeResumeStateFor (hintUnknown, sổ 0372)",
    ca: [{ tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ outcome unknown WITHOUT the prefix (the complete lost it): the authorisation ledger shows r1 issued with no result ⇒ never re-sent" }],
  },
  {
    ma: "B-3a",
    viTri: "foeEngine.ts:outcomeUnknownOf (resume state + ctx)",
    ca: [{ tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ outcome unknown WITHOUT the prefix (the complete lost it): the authorisation ledger shows r1 issued with no result ⇒ never re-sent" }],
  },
  { ma: "B-3b", viTri: "foeEngine.ts:execStep (đường chỉ bù trừ, outcomeUnknownOf)", ca: [] },
  {
    ma: "B-3c",
    viTri: "foeEngine.ts:execStep (bước đã gửi lần trước, outcomeUnknownOf)",
    ca: [
      { tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ outcome unknown WITHOUT the prefix (the complete lost it): the authorisation ledger shows r1 issued with no result ⇒ never re-sent" },
      { tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ N1 real ordering: the ledger result reached central (resultReportedAt set) but the result row and the prefix were lost ⇒ r1 is never re-sent" },
    ],
  },
  {
    ma: "B-3d",
    viTri: "foeEngine.ts:congBuTru (không gửi lại bù trừ)",
    ca: [{ tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ c1 sent, its result refused by the journal ⇒ held; Continue: neither r1 nor c1 is sent again, the run fails" }],
  },
  { ma: "B-3e", viTri: "foeEngine.ts:ketCucRiengKhongRo (nhãn 'not sent')", ca: [] },
  { ma: "B-3f", viTri: "foeEngine.ts URGENT compensationUnknown", ca: [] },
  { ma: "B-3g", viTri: "foeEngine.ts:bangChungSauChot / runCompensation", ca: [] },
  {
    ma: "B-7",
    viTri: "foeEngine.ts:runAbortStopSweep URGENT abortSweepUnfinished (runDaChotKhongRo, ctx)",
    ca: [{ tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "T9F3E-ABORT (c) an Abort in that gap whose sweep passes its ceiling: the URGENT of a latched run's unfinished sweep (abortSweepUnfinished)" }],
  },
  { ma: "B-11", viTri: "foeEngine.ts:runAbortStopSweep catch ⇒ baoKhongDoc (khoa / runDaChotKhongRo)", ca: [] },
  { ma: "B-14", viTri: "foeEngine.ts:resumeRun ⇒ buTruKhongRoCho (ctx): Continue cần người + lý do", ca: [] },
  {
    ma: "C-1",
    viTri: "edgeReportsCentral.ts: superseded của sổ 0372 (auth_unused)",
    ca: [
      { tep: "server/services/edge/edgeJournal.dot10.test.ts", ten: "★ fix review 7 (R-10-bp): auth.unused is fsynced BEFORE it resolves; the jti is consumed-as-unused (never usable, also after a restart); a USED jti is never marked unused" },
      { tep: "server/services/edge/edgeReports.dot10.db.test.ts", ten: "★ R-10-bq (scan on 202960fde): `auth_unused` is REFUSED whenever central holds evidence the jti WAS used — a step row past dispatch citing it, an actuation event citing it — and is accepted once only; the outcome stays unknown (supersededAt NULL)" },
    ],
  },
  {
    ma: "C-2",
    viTri: "foeEngine.ts:edgeResumeStateFor (42P01 ⇒ từ chối Continue)",
    ca: [
      { tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "★ N3 any ledger error (42703, 42883, a connection error) refuses the Continue; T9F3E-C2 a missing ledger table (42P01) refuses it too, and says why" },
      { tep: "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts", ten: "T9F3E-C2-ABORT (C-2) the ledger table missing (42P01): the Continue is refused and says why; an Abort is not — it ends the run and its pinned STOP goes" },
    ],
  },
  { ma: "C-3", viTri: "edgeReportsCentral / edgeAuthorizeCentral: 42P01 ⇒ 503 edge_unavailable", ca: [] },
  { ma: "R-ii", viTri: "foeRunStore.ts:khongRoCuaDoan (lỗi SELECT trong giao dịch, cần PG thật)", ca: [] },
];
/** HST 14/11 T2-DK1 — ô chưa có ca giữ. Census khẳng định BẰNG ĐÚNG danh sách này (thêm / bớt phải sửa có chủ ý). PHẢI RỖNG trước khi A2(n) gộp. */
const CHUA_CO_CA: readonly string[] = ["A1-5", "A1-6", "A1-23", "A1-36", "B-3b", "B-3e", "B-3f", "B-3g", "B-11", "B-14", "C-3", "R-ii"];

/** Tên mọi ca `it(...)` / `test(...)` có tên là chuỗi literal (không tính `.skip` / `.todo`) trong một tệp test. */
export function tenCaTrongTep(src: string, tep: string): Set<string> {
  const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
  const ra = new Set<string>();
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "it" || n.expression.text === "test") && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) ra.add(n.arguments[0].text);
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const khoa = (x: { tep: string; ham: string; dang: string; chu: string }): string => `${x.tep} | ${x.ham} | ${x.dang} | ${x.chu}`;

function demTheoKhoa<T extends { tep: string; ham: string; dang: string; chu: string }>(ds: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of ds) {
    const k = khoa(x);
    const a = m.get(k) ?? [];
    a.push(x);
    m.set(k, a);
  }
  return m;
}

/**
 * Tệp NGOÀI phạm vi mà tệp trong phạm vi import trực tiếp (đường tương đối hoặc `@shared/`), MỘT tầng: chỉ để giải giá trị `const`
 * ở L2 (ví dụ `FOE_ENGINE_TOOL = "foe.orchestration"` ở `ot/otActionBinding.ts` không phải hằng chữ trạng thái). Không quét các tệp này.
 */
export function tepNhapNgoai(nguon: ReadonlyArray<{ tep: string; src: string }>): string[] {
  const trong = new Set(nguon.map((n) => n.tep));
  const ra = new Set<string>();
  for (const { tep, src } of nguon) {
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, false);
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
      const m = st.moduleSpecifier;
      if (!m || !ts.isStringLiteral(m)) continue;
      const s = m.text;
      let goc: string | undefined;
      if (s.startsWith("./") || s.startsWith("../")) goc = resolve(GOC, tep, "..", s);
      else if (s.startsWith("@shared/")) goc = resolve(GOC, "shared", s.slice("@shared/".length));
      if (!goc) continue;
      for (const ung of [`${goc}.ts`, resolve(goc, "index.ts"), goc.replace(/\.js$/, ".ts")]) {
        if (!existsSync(ung) || !statSync(ung).isFile()) continue;
        const rel = relative(GOC, ung).replace(/\\/g, "/");
        if (!trong.has(rel)) ra.add(rel);
        break;
      }
    }
  }
  return [...ra].sort();
}

/** Tên hàm / biến được KHAI BÁO (mọi tầng) trong các tệp: K2 kiểm tên hàm trung gian bằng AST, không bằng chữ (chú thích không tính). */
export function tenKhaiBao(nguon: ReadonlyArray<{ tep: string; src: string }>): Set<string> {
  const ra = new Set<string>();
  for (const { tep, src } of nguon) {
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
    const di = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) ra.add(n.name.text);
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return ra;
}

function quetPhamVi(): { tep: string[]; khop: ChoKhop[]; khaiBao: Set<string> } {
  const tep = tepTrongPhamVi();
  const nguon = tep.map((t) => ({ tep: t, src: docNguon(t) }));
  const bang = gomHang([...nguon, ...tepNhapNgoai(nguon).map((t) => ({ tep: t, src: docNguon(t) }))]);
  return { tep, khop: nguon.flatMap(({ tep: t, src }) => quet(src, t, bang)), khaiBao: tenKhaiBao(nguon) };
}

const dongGoiY = (x: ChoKhop): string =>
  `  { tep: ${JSON.stringify(x.tep)}, ham: ${JSON.stringify(x.ham)}, dang: ${JSON.stringify(x.dang)}, chu: ${JSON.stringify(x.chu)}, ma: "?", lyDo: "?" }, // :${x.dong}`;

/** Minor m4 — thông báo đỏ nói cách sửa. */
const CACH_SUA_CHO_MOI =
  "CÁCH SỬA: KHÔNG suy trạng thái an toàn từ chữ — sửa mã để dùng dữ liệu có cấu trúc (trường, mã, cờ). Chỉ khi chỗ này KHÔNG quyết an toàn " +
  "(hiển thị / log / audit): thêm dòng đóng băng kèm mã ô của bảng kiểm kê (hoặc MOI-x) và lý do, báo scada-master; KHÔNG tự tăng SO_DONG_MOC " +
  "(tăng mốc cần quyết định HST, xem LICH_SU_MOC).";

describe("census — chữ không phải trạng thái (central/edge)", () => {
  const { tep, khop, khaiBao } = quetPhamVi();

  it("phạm vi quét không rỗng (glob rỗng ⇒ census mù) và mỗi gốc có tệp", () => {
    expect(tep.length, "số tệp trong phạm vi").toBeGreaterThanOrEqual(100);
    for (const g of GOC_QUET) expect(tep.some((t) => t.startsWith(`${g}/`)), `gốc ${g} không có tệp nào`).toBe(true);
    expect(tep).toContain("server/services/ot/commandDispatcher.ts");
    expect(tep.some((t) => /\.test\.ts$|\.testkit\.ts$/.test(t) || t.split("/").some((p) => p.startsWith("__"))), "lọt tệp test/testkit/__").toBe(false);
    // K2 (bản rà T2) — hàm trung gian phải còn được KHAI BÁO trong phạm vi (AST); tên chỉ còn trong chú thích thì không tính
    for (const h of HAM_TRUNG_GIAN) expect(khaiBao.has(h.ten), `hàm trung gian ${h.ten} không còn được khai báo trong phạm vi ⇒ sửa HAM_TRUNG_GIAN`).toBe(true);
  });

  it("mọi chỗ khớp có dòng đóng băng", () => {
    const dongBang = demTheoKhoa(DONG_BANG);
    const thua: ChoKhop[] = [];
    for (const [k, ds] of demTheoKhoa(khop)) {
      const n = dongBang.get(k)?.length ?? 0;
      if (ds.length > n) thua.push(...ds.slice(n));
    }
    expect(thua.length, `chỗ khớp CHƯA có dòng đóng băng (${thua.length}). ${CACH_SUA_CHO_MOI}\n${thua.map(dongGoiY).join("\n")}`).toBe(0);
  });

  it("mọi dòng đóng băng còn chỗ khớp (dòng mồ côi ⇒ xoá khỏi danh sách)", () => {
    const thay = demTheoKhoa(khop);
    const moCoi: string[] = [];
    for (const [k, ds] of demTheoKhoa(DONG_BANG)) {
      const n = thay.get(k)?.length ?? 0;
      for (let i = n; i < ds.length; i += 1) moCoi.push(`xoá dòng ${ds[i].ma} [${k}] khỏi danh sách, rồi thêm số dòng mới vào cuối LICH_SU_MOC và hạ SO_DONG_MOC trong cùng commit`);
    }
    expect(moCoi, moCoi.join("\n")).toEqual([]);
  });

  it("HST 14/11 T2-DK3: số dòng đóng băng BẰNG ĐÚNG mốc; lịch sử mốc không tăng, ghim đầu, cuối = mốc", () => {
    expect(
      DONG_BANG.length,
      `danh sách có ${DONG_BANG.length} dòng, mốc SO_DONG_MOC = ${SO_DONG_MOC}. Xoá dòng ⇒ thêm ${DONG_BANG.length} vào cuối LICH_SU_MOC và hạ SO_DONG_MOC cùng commit. ` +
        `Thêm dòng ⇒ KHÔNG được: ${CACH_SUA_CHO_MOI}`,
    ).toBe(SO_DONG_MOC);
    expect(LICH_SU_MOC[0], "phần tử đầu của LICH_SU_MOC là mốc gốc (ghim, HST 14/11)").toBe(MOC_GOC);
    expect(LICH_SU_MOC[LICH_SU_MOC.length - 1], "phần tử cuối của LICH_SU_MOC phải bằng SO_DONG_MOC").toBe(SO_DONG_MOC);
    for (let i = 1; i < LICH_SU_MOC.length; i += 1) {
      expect(LICH_SU_MOC[i], `LICH_SU_MOC[${i}] = ${LICH_SU_MOC[i]} > LICH_SU_MOC[${i - 1}] = ${LICH_SU_MOC[i - 1]}: mốc chỉ được GIẢM (tăng cần quyết định HST)`).toBeLessThanOrEqual(LICH_SU_MOC[i - 1]);
    }
  });

  it("HST 14/11 T2-DK1: 21 ô ngoài tầm có trong sổ; mỗi ca giữ còn tồn tại; CHUA_CO_CA đúng danh sách đã biết", () => {
    expect(O_NGOAI_TAM.map((o) => o.ma), "danh sách 21 ô ngoài tầm (đổi danh sách phải sửa có chủ ý)").toEqual(
      ["A1-5", "A1-6", "A1-12", "A1-23", "A1-31", "A1-36", "B-2", "B-3a", "B-3b", "B-3c", "B-3d", "B-3e", "B-3f", "B-3g", "B-7", "B-11", "B-14", "C-1", "C-2", "C-3", "R-ii"],
    );
    const mat: string[] = [];
    const cacheTen = new Map<string, Set<string>>();
    for (const o of O_NGOAI_TAM) {
      for (const c of o.ca) {
        if (!cacheTen.has(c.tep)) cacheTen.set(c.tep, existsSync(resolve(GOC, c.tep)) ? tenCaTrongTep(docNguon(c.tep), c.tep) : new Set());
        if (!cacheTen.get(c.tep)!.has(c.ten)) mat.push(`ô ${o.ma} (${o.viTri}): ca giữ "${c.ten.slice(0, 120)}…" không còn trong ${c.tep} (bị xoá / đổi tên / skip) ⇒ khôi phục ca, hoặc ghi ca mới đã đọc, hoặc chuyển ô vào CHUA_CO_CA`);
      }
    }
    expect(mat, mat.join("\n")).toEqual([]);
    const khongCa = O_NGOAI_TAM.filter((o) => o.ca.length === 0).map((o) => o.ma);
    expect(khongCa, "ô không có ca giữ phải đúng là CHUA_CO_CA (thêm / bớt phải sửa có chủ ý); CHUA_CO_CA phải RỖNG trước khi A2(n) gộp").toEqual([...CHUA_CO_CA]);
  });

  it("mỗi dòng đóng băng có mã bảng hợp lệ, lý do, nhãn hợp lệ", () => {
    for (const d of DONG_BANG) {
      expect(d.ma, khoa(d)).toMatch(/^(A1-\d+|B-\d+[a-g]?|C-\d+|E-\d+|R-ii?|MOI-\d+)$/);
      expect(d.lyDo.trim().length, `thiếu lý do: ${khoa(d)}`).toBeGreaterThan(5);
      if (d.nhan !== undefined) expect(["tuyen-cu-chi", "hien-thi"], khoa(d)).toContain(d.nhan);
    }
  });
});

describe("bộ quét — bắt đúng dạng, kể cả xuống dòng và optional chaining", () => {
  const f = "server/x.ts";
  const q = (s: string, hang = "") => {
    const bang = gomHang([{ tep: "server/hang.ts", src: hang }]);
    return quet(s, f, bang);
  };

  it("L1: phép gọi xuống dòng và optional chaining", () => {
    const ds = q('function f(e: any) {\n  if (e\n    ?.message\n    ?.startsWith(\n      "X",\n    )) return 1;\n}');
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ ham: "f", dang: ".startsWith", chu: 'e?.message?.startsWith("X")', dong: 2 });
    expect(q('const g = (err: any) => err?.includes?.("x");')).toHaveLength(1);
    expect(q("const g = (r: any) => r.error!.toLowerCase().split(',');")[0]).toMatchObject({ ham: "g", dang: ".split" });
    expect(q("const g = (o: any) => String(o.detail ?? '').indexOf('a');")).toHaveLength(1);
    expect(q("const g = (loiHien: string) => loiHien.endsWith('a');")).toHaveLength(1);
    expect(q("const g = (rawLine: string) => rawLine.replace(/a/g, '');")).toHaveLength(1);
  });

  it("L1: regex .test/.exec và JSON.parse áp trên đối số", () => {
    expect(q("const g = (e: any) => /x/.test(\n  e?.message ?? '',\n);")[0]).toMatchObject({ dang: "/re/.test", chu: '/x/.test(e?.message??"")' });
    expect(q("const RE = /x/; const g = (text: string) => RE.exec(text);")[0]).toMatchObject({ dang: "re.exec" });
    expect(q("const g = (raw: string) => JSON.parse(raw.slice(1));")[0]).toMatchObject({ dang: "JSON.parse" });
  });

  it("L2: hằng FOE_/EDGE_/[[A2N trong phép so chữ, giải qua const của tệp khác", () => {
    expect(q('const g = (x: string) => x.startsWith(`${FOE_STOP_NOT_SENT}:`);')[0]).toMatchObject({ dang: ".startsWith" });
    expect(q('const g = (x: string) => x === "EDGE_OUTCOME_UNKNOWN";')[0]).toMatchObject({ dang: "===" });
    expect(q("const g = (x: string) => x.lastIndexOf(DAU) + x.indexOf(DAU);", 'export const DAU = " [[A2N:";')).toHaveLength(1);
    expect(q("const g = (x: string) => { switch (x) { case MA: return 1; } };", 'export const MA = "FOE_X";')[0]).toMatchObject({ dang: "case" });
    expect(q("const g = (x: string) => /^EDGE_HELD\\(/.test(x);")[0]).toMatchObject({ dang: "/re/.test" });
    // hằng số (không phải chữ) tên EDGE_ ⇒ không tính
    expect(q("const g = (v: number) => v === EDGE_PROTOCOL_VERSION;", "export const EDGE_PROTOCOL_VERSION = 2;")).toHaveLength(0);
    // hằng tên FOE_ mà giá trị không bắt đầu bằng FOE_ ⇒ không tính; tên biến môi trường (thuộc tính) ⇒ không tính
    expect(q("const g = (t: string) => t === FOE_ENGINE_TOOL;", 'export const FOE_ENGINE_TOOL = "foe.orchestration";')).toHaveLength(0);
    expect(q('const g = () => process.env.FOE_ENABLED === "1";')).toHaveLength(0);
    // không giải được (nhập từ ngoài) mà tên là FOE_* ⇒ tính
    expect(q("const g = (t: string) => t.startsWith(FOE_KHONG_RO_DAU);")).toHaveLength(1);
  });

  it("L3: nơi gọi / tham chiếu hàm trung gian (trừ khai báo, import, export)", () => {
    const ds = q('import { docDsKhongRoEdge } from "./a";\nexport { docDsKhongRoEdge };\nfunction h(e: string) {\n  return docDsKhongRoEdge(\n    e,\n    new Set(),\n  );\n}\nconst k = [1].map(chotTuHang);');
    expect(ds.map((d) => [d.ham, d.dang, d.chu])).toEqual([
      ["h", "goi:docDsKhongRoEdge", "docDsKhongRoEdge(e,newSet())"],
      ["(cap-tep)", "goi:chotTuHang", "tham-chieu:chotTuHang"],
    ]);
    expect(q("export function docDsKhongRoEdge(x: string) { return x; }")).toHaveLength(0);
    // vị trí KIỂU (`typeof`) không phải nơi gọi; lời gọi cạnh nó vẫn tính
    expect(q("const g = (r: unknown) => chotTuHang(r as Parameters<typeof chotTuHang>[0]);").map((d) => d.chu)).toEqual(["chotTuHang(rasParameters<typeofchotTuHang>[0])"]);
  });

  it("L1: `msg`, `errorText` là tên chữ; L1-CẶP chỉ khớp đúng (tệp, hàm bao, định danh)", () => {
    expect(q("const g = (msg: string) => msg.startsWith(T);")).toHaveLength(1);
    // I4: errorText (cột chữ lỗi của command log)
    expect(q('const g = (r: any) => r.errorText?.startsWith("ADAPTER_OFFLINE:");')).toHaveLength(1);
    expect(q("const maTienTo = (errorText: string) => /^([A-Z]+):/.exec(errorText);")).toHaveLength(1);
    const bang = gomHang([]);
    const tm = "server/services/robot/drivers/techmanDriver.ts";
    expect(quet("function classifyTmsctReply(frame: any) { return frame?.data.indexOf(','); }", tm, bang)).toHaveLength(1);
    expect(quet("function classifyTmsctReply(frame: any, result: string) { return /^OK/.exec(result); }", tm, bang)).toHaveLength(1);
    expect(quet('function classifyTmsctReply(frame: any) { return frame.header !== "TMSCT"; }', tm, bang)).toHaveLength(1);
    // cùng định danh ở tệp khác / ở hàm khác cùng tệp ⇒ không khớp; định danh khác cùng hàm ⇒ không khớp
    expect(quet("function classifyTmsctReply(frame: any) { return frame.data.indexOf(','); }", "server/services/robot/khac.ts", bang)).toHaveLength(0);
    expect(quet("function khac(frame: any) { return frame.data.indexOf(','); }", tm, bang)).toHaveLength(0);
    expect(quet("function classifyTmsctReply(frame: any) { return frame.id.indexOf(','); }", tm, bang)).toHaveLength(0);
    const ag = "server/services/edge/edgeExecutionAgent.ts";
    expect(quet('class EdgeExecutionAgent { pullOnce(r: any) { return r.outcome.includes("pending:"); } }', ag, bang)).toHaveLength(1);
    expect(quet('class EdgeExecutionAgent { resendStops(r: any) { return r.outcome === "failed"; } }', ag, bang)).toHaveLength(0);
    expect(quet('class EdgeExecutionAgent { pullOnce(r: any) { return r.outcome.includes("pending:"); } }', "server/services/edge/edgeRunStore.ts", bang)).toHaveLength(0);
  });

  it("I2: so BẰNG với chuỗi, switch, phép THÀNH VIÊN trên chữ tự do (không có tiền tố)", () => {
    expect(q('const g = (msg: string) => msg === "Transaction has timed out";')[0]).toMatchObject({ dang: "===", chu: 'msg==="Transaction has timed out"' });
    expect(q("const g = (e: any) => `socket hang up` != e.message;")[0]).toMatchObject({ dang: "!=" });
    expect(q('function g(err: any) { switch (err.message) { case "socket hang up": return 1; } return 0; }')[0]).toMatchObject({ dang: "switch", chu: "switch(err.message)" });
    expect(q("const g = (err: any) => CHU_QUA_HAN.includes(err.message);")[0]).toMatchObject({ dang: ".includes" });
    expect(q("const g = (msg: string) => DA_BAO.has(msg);")[0]).toMatchObject({ dang: ".has" });
    expect(q("const g = (msg: string) => MA.indexOf(msg);")[0]).toMatchObject({ dang: ".indexOf" });
    // THA: typeof; `reason` / `detail` (mã có cấu trúc); so với không phải chuỗi
    for (const s of [
      'const g = (error: unknown) => typeof error === "string";',
      'const g = (reason: string) => reason === "outcomeUnknown";',
      'const g = (o: any) => o.detail === "x";',
      "const g = (error: unknown) => error === null;",
      "const g = (reason: string) => LY_DO.has(reason);",
    ]) expect(q(s), s).toHaveLength(0);
  });

  it("I3: chữ đã ép thành chuỗi trước khi so: String(e), template, phép +, toString, biến của catch", () => {
    expect(q('const g = (e: unknown) => String(e).includes("TIMEOUT occurred");')).toHaveLength(1);
    expect(q('const g = (err: any) => `${err.message}`.startsWith("Transaction has");')).toHaveLength(1);
    expect(q('const g = (err: any) => (err.message + "").includes("timed out");')).toHaveLength(1);
    expect(q('const g = (e: Error) => e.toString().startsWith("Error: x");')).toHaveLength(1);
    expect(q('function g() { try { return 1; } catch (x) { return String(x).includes("ECONNRESET"); } }')).toHaveLength(1);
    expect(q('function g() { try { return 1; } catch (x) { return `${x}`.includes("ECONNRESET"); } }')).toHaveLength(1);
    // THA: biến không phải lỗi bị ép chuỗi; e không ép chuỗi (đối tượng)
    for (const s of ['const g = (id: number) => String(id).startsWith("1");', 'const g = (e: any) => e.includes("x");', "const g = (k: string, n: number) => `${k}${n}`.includes(\"a\");"]) {
      expect(q(s), s).toHaveLength(0);
    }
  });

  it("I1 + m6: khoá dựng từ AST — prettier (arrowParens, nháy, ngoặc, xuống dòng, dấu phẩy treo, ;) và chú thích không đổi khoá", () => {
    const a = q('const g = (rows: any[], id: string) => viChuaRaCuaLoi(rows.find((r) => r.stepId === id)?.error);');
    const b = q("const g = (rows: any[], id: string) =>\n  viChuaRaCuaLoi(\n    // ghi chú\n    rows.find(r => r.stepId === id)?.error, /* x */\n  )");
    expect(a.map(khoa)).toEqual(b.map(khoa));
    expect(a[0].chu).toBe("viChuaRaCuaLoi(rows.find((r)=>r.stepId===id)?.error)");
    expect(q("const g = (e: any) => e.message.startsWith('x');").map(khoa)).toEqual(q('const g = (e: any) => ((e.message)).startsWith("x");').map(khoa));
    expect(q('const g = (e: any) => tapKhongRoEdge({ "def": e, n: 1.0 });').map(khoa)).toEqual(q("const g = (e: any) => tapKhongRoEdge({ def: e, n: 1 });").map(khoa));
  });

  it("m1: bí danh import của hàm trung gian vẫn là nơi gọi", () => {
    const ds = q('import { docDsKhongRoEdge as doc, chotTuHang } from "./x";\nconst g = (e: string) => doc(e, new Set());');
    expect(ds.map((d) => [d.dang, d.chu])).toEqual([["goi:docDsKhongRoEdge", "doc(e,newSet())"]]);
    expect(q('import { khac as doc } from "./x";\nconst g = (e: string) => doc(e);')).toHaveLength(0);
  });

  it("DK1: tenCaTrongTep đọc đúng tên ca (it / test), không tính it.skip", () => {
    const t = tenCaTrongTep('describe("d", () => { it("ca A", () => {}); test(`ca B`, () => {}); it.skip("ca C", () => {}); });', "x.test.ts");
    expect([...t]).toEqual(["ca A", "ca B"]);
  });

  it("THA: chữ không mang tên chữ, mã có cấu trúc, tên gần giống", () => {
    for (const s of [
      'const g = (name: string) => name.startsWith("a");',
      'const g = (ctx: any) => ctx.ma === "X";',
      'const g = (errors: string[]) => errors.includes("a");',
      'const g = (errorCode: string) => errorCode.startsWith("a");',
      "const g = (x: string) => x.lastIndexOf('a');",
      'const g = (o: any) => o.message.length > 0 && JSON.stringify(o.message);',
    ]) expect(q(s), s).toHaveLength(0);
  });

  it("hàm bao: phương thức lớp, arrow gán biến, callback vô danh lấy hàm ngoài", () => {
    const ds = q('class A { m(e: any) { return [1].some(() => e.message.includes("x")); } }\nconst z = { p: (err: any) => err.startsWith("y") };');
    expect(ds.map((d) => d.ham)).toEqual(["A.m", "p"]);
  });

  it("đọc nguồn chuẩn hoá CRLF ⇒ khoá không đổi theo kết thúc dòng", () => {
    const lf = 'function f(e: any) {\n  return e.message\n    .startsWith(`X\nY`);\n}';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(veLf(crlf)).toBe(lf);
    expect(q(veLf(crlf)).map(khoa)).toEqual(q(lf).map(khoa));
    expect(q(veLf(crlf))).toHaveLength(1);
    expect(existsSync(resolve(GOC, "server/services/orchestration/foe/foeRunStore.ts"))).toBe(true);
  });
});
