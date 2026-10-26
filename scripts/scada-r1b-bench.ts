/**
 * SCADA R1b-1 Task 12 — bench nghiệm thu STOP HMI (`scadaCommands.dungMay`) trên OpenPLC (Docker) + safety PLC MÔ PHỎNG. CHẠY TAY, không vào CI.
 *
 *   npx tsx scripts/scada-r1b-bench.ts [--endpoint tcp://127.0.0.1:15502] [--container avi-openplc-bench] [--web http://127.0.0.1:18080]
 *       [--poll 1000] [--timeout 800] [--lap 3] [--start-neu-tat] [--khong-docker] [--r1b2a] [--r1b2b1] [--cat-lien-ket] [--dump-proxy]
 *
 * R1b-2a Task 15 — `--r1b2a` thêm ô L1 vào MỖI lượt (sau S1 / S2 / X2): `dispatch()` như tool AI lên một thanh ghi int CHƯA khai scale 1
 * (thanh ghi thứ TƯ giữ giá trị của bước 0): 2,5 ⇒ OFF_STEP goiY 3 (thanh ghi không đổi); "abc" ⇒ TYPE_MISMATCH (thanh ghi không đổi);
 * 3 ⇒ thanh ghi = 3. Trước R1b-2a, 2,5 đi nguyên tới driver và PLC nhận Math.round(2,5) = 3 im lặng. Không tải chương trình PLC, chỉ ghi / đọc
 * thanh ghi holding như R1b-1. Chạy trên OpenPLC CHỈ khi điều phối OK tại thời điểm đó (Q10, sau khi đo commit còn trống ≥ 10 GB và
 * `docker update --memory 1g --memory-swap 1g avi-openplc-bench`).
 *
 * R1b-2b-1 Task 16 Step 3 — `--r1b2b1` thêm ô B1 (kiem-dinh G1 + điều kiện 1c của điều phối) vào MỖI lượt (sau L1 nếu có), trên MỘT coil:
 *   • BƯỚC 0b: coil 0..15 (`coil:1..16`, 1-BASED như cú pháp sản phẩm) — tìm coil ĐẦU TIÊN GIỮ giá trị: ghi FC05 giá trị NGƯỢC gốc, đọc lại
 *     +200/+1000/+2500 ms bằng client riêng, rồi ghi lại giá trị gốc và đọc lại +200/+1000/+2500 ms (giữ CẢ HAI giá trị + trả gốc). Chương trình
 *     OpenPLC có thể lái một số coil mỗi chu kỳ ⇒ coil đó bị bỏ qua. Không coil nào giữ ⇒ in "bench B1 not measurable" kèm bằng chứng (mọi lần
 *     đọc), ghi một dòng B1 KHÔNG ĐẠT vào bảng (không giả số) — các ô khác vẫn chạy.
 *   • B1a: tag `bcoil` kiểu bool CHƯA khai (mọi cột 0431 NULL) trên coil đó, adapter bench; `dispatch()` như tool AI (cùng đường X2 / L1,
 *     AI_OT_CONTROL_ENABLED=false): "false" ⇒ coil 0 (coil đặt 1 trước); "0" ⇒ coil 0 (coil đặt lại 1 bằng client riêng ở giữa); "off" ⇒ rejected
 *     TYPE_MISMATCH, coil không đổi (đặt 1 trước — bản lỏng "off"⇒FALSE sẽ thấy được); 2 ⇒ rejected TYPE_MISMATCH, coil không đổi (đặt 0 trước —
 *     bản lỏng Boolean(2)=TRUE sẽ thấy được).
 *   • B1b (điều kiện 1c): tag `icoil` kiểu INT trên CÙNG coil, ghim STOP `stop_value = 1` (mức 1), trên MÁY + ADAPTER RIÊNG cùng trạm (cùng endpoint):
 *     coil đặt 0, bấm STOP HMI `scadaCommands.dungMay` trên máy đó ⇒ `acked_verified` (T6: đọc lại lớp bit so theo bool) và client riêng đọc coil
 *     = 1. Máy riêng vì `dungMay` gửi MỌI ghim của MỌI adapter của máy: ghim thứ hai trên máy bench sẽ làm S1 / S2 ghi cả coil (kiểm
 *     `ketQua.length === 1` vẫn đúng nhưng ô S đổi nội dung) và B1b không tách được khỏi ghim `dung`. Ghim đặt bằng INSERT thẳng như ghim `dung`
 *     (1 thuộc tập 8 giá trị nên `datStopPin` cũng nhận; census `stopPinDatMotCho` cho phép tệp này).
 *   • Cuối MỖI lượt: coil trả về giá trị gốc của bước 0b, đọc lại bằng client riêng (dòng "B1-trả").
 *
 * R1b-2b-1 Task 17 (bench B1b lượt 1: STOP `timeout` 5124 ms khi liên kết b1 rớt lúc FC5 đang bay) — `--cat-lien-ket` (cần `--r1b2b1`): adapter
 * B1b nối qua một PROXY TCP trong tiến trình (127.0.0.1, cổng OS cấp) tới `--endpoint`; ngay trước STOP HMI của ô B1b mỗi lượt, proxy được LÊN CÒ và
 * CẮT kết nối của b1 ở FC5 đầu tiên — tái hiện CÓ CHỦ ĐÍCH (tất định, không trông vào OpenPLC) việc liên kết mất khi lệnh ghi đang bay:
 *   • lượt LẺ "cắt trước khi gửi": FC5 KHÔNG được chuyển tới PLC ⇒ coil giữ 0;
 *   • lượt CHẴN "cắt sau khi gửi": FC5 được chuyển tới PLC rồi mới cắt (không chuyển câu trả lời) ⇒ coil lên 1 nhưng ta không biết.
 *   Mong đợi CẢ HAI: `timeout` ok=false (không rõ kết cục) trong < 1000 ms — KHÔNG `acked*`, KHÔNG `failed`, không treo 5000 ms. Bằng chứng in
 *   theo lượt: `health().lastError` của b1, mốc cắt so với lúc bấm, thời gian b1 nối lại. Trước lượt kế, đợi b1 nối lại (vòng canh legacy).
 *   Ô B1b thường (ghim 1 ⇒ acked_verified) KHÔNG chạy khi có cờ này.
 *   Chẩn đoán lần chạy OpenPLC thật bị huỷ (task-17-report.md "Bench diagnosis"): proxy nay ở `scripts/scada-bench-proxy.ts` — chuyển tiếp THEO KHUNG MBAP
 *   (tách khung qua biên đoạn, mỗi khung một write, setNoDelay), cắt đúng ở KHUNG FC5. Lượt 1 chạy TRƯỚC một ô ĐỐI CHỨNG "B1b-thông": proxy thông suốt
 *   (không cắt) 5 s poll b1 + STOP HMI ⇒ acked_verified. Đọc kết quả trên OpenPLC thật: ĐỐI CHỨNG đỏ (b1 rớt / yêu cầu qua proxy không được trả lời)
 *   ⇒ lỗi ở CÔNG CỤ (proxy), các ô cắt không đọc được; ĐỐI CHỨNG xanh ⇒ proxy trung thực, b1 rớt poll lúc trước phải tìm ở đường nối lại của sản phẩm qua
 *   proxy / OpenPLC khựng lúc khởi động. `--dump-proxy`: in từng đoạn + khung MBAP mỗi chiều (bằng chứng). MỌI lỗi của một bước ⇒ một dòng ĐỎ có lý do +
 *   stack, lượt chạy tiếp (không bao giờ huỷ cả lần chạy); mỗi dòng in ngay khi có. Không có biến thể "khởi động lại container + adapter MỚI mỗi lượt" (cần
 *   docker + dựng lại otManager mỗi lượt — xem task-17-report.md).
 *
 * Container DÙNG CHUNG (điều phối 2026-10-25): mặc định script KHÔNG khởi động container. Container không `running` hoặc Modbus không trả lời
 * ⇒ in "bench not run — container unavailable" kèm bằng chứng (trạng thái `docker inspect`, kết quả thăm dò) và thoát mã 3, không đụng gì.
 *   • `--start-neu-tat`: hành vi của bench R1a (start / unpause, bấm Start qua web, cuối cùng trả về đúng trạng thái ban đầu) — CHỈ khi
 *     người điều phối cho phép.
 *   • `--khong-docker`: bỏ mọi lệnh docker (chạy khô trên một endpoint Modbus bất kỳ, vd. máy chủ mô phỏng trong tiến trình) — KHÔNG phải
 *     bench OpenPLC; dùng để kiểm mã của script.
 *
 * Container: avi-openplc-bench chạy với --memory 1g (điều phối 2026-10-25 — máy dùng chung với llama-server); gỡ bằng
 *   docker update --memory 0 --memory-swap -1 avi-openplc-bench nếu cần.
 * Trong tiến trình, KHÔNG đụng :3000 / :8091 / GPU. CSDL = `_test` (suy từ DATABASE_URL của .env như vitest.setup.ts: chỉ đọc MỘT khoá đó,
 * thêm hậu tố `_test`; tên phải chứa "test" và khác DB dev, nếu không script dừng). Mọi cờ đặt TƯỜNG MINH trong tiến trình — `.env` không
 * được nạp; `OT_CONTROL_ENABLED=true` CHỈ ở đây (D9).
 *
 * Đường đo (đúng đường sản phẩm, khuôn scripts/scada-r1a-bench.ts):
 *   • otManager THẬT (`startOt`, legacy, cờ V2 bật) qua seam `setAdapterSource` trên ModbusDriver THẬT; vòng poll THẬT nuôi bộ đệm ⇒ kênh
 *     chế độ là tag poll trung tâm đọc từ PLC. Adapter cùng `id` với hàng `device_adapters` thật trên `_test`.
 *   • STOP HMI: `scadaCommands.dungMay` qua tRPC caller (admin tạo bằng `taoNguoiDungTest`; resolve hook thay "vitest" bằng shim `afterAll`).
 *     Ghim `stop_value` = 0 trên MỘT thanh ghi (`dung`, int mức 1, dải 0..100).
 *   • Đối chứng LOCAL: `scadaCommands.request` thường trên cùng kênh ở LOCAL ⇒ MODE_LOCAL (chứng minh cổng chế độ thấy máy LOCAL).
 *   • X2 (điều phối): `dispatch()` như tool AI lên tag int CHƯA khai scale 10 ở thanh ghi thứ ba: 25 ⇒ OFF_STEP (thanh ghi không đổi);
 *     30 ⇒ thanh ghi = 3 (số THÔ trên PLC thật).
 *   • Safety PLC giả trong tiến trình (khuôn scripts/safety-plc-bench.ts `selfServer`) + hàng `safety_plc_configs` THẬT theo trạm; giữ khoá
 *     seed độc quyền. Adapter có `commissioning_records` thật (OT_COMMISSIONING_REQUIRED bật như mặc định sản phẩm).
 *
 * Oracle độc lập: một client Modbus RIÊNG (kết nối mới mỗi lần) đọc thanh ghi TRƯỚC/SAU mỗi bước.
 *
 * BƯỚC 0 (bắt buộc): thanh ghi holding 0..17 (`holding:1..18`) có GIỮ giá trị ghi vào không (ghi FC06 một giá trị lạ, đọc lại +200/+1000/
 * +2500 ms, trả giá trị gốc). Cú pháp tag của sản phẩm là 1-BASED (`holding:N` = thanh ghi N-1).
 *
 * Trạng thái cũ của container được GHI và TRẢ LẠI: giá trị gốc của MỌI thanh ghi 0..17 đọc trước khi chạm (ghi lại cuối cùng) + coil B1 (gốc
 * của bước 0b, ghi lại cuối mỗi lượt và cuối cùng) + trạng thái running/paused/exited. Mọi hàng không-WORM đã tạo được dọn.
 */
import { execFileSync } from "node:child_process";
import { createRequire, registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { taoProxyModbus, type KieuCat } from "./scada-bench-proxy";

// ── "vitest" ⇒ shim (taoNguoiDungTest đăng ký afterAll lúc nạp module; ngoài vitest runner lời gọi đó ném) ──
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "vitest") return { url: "data:text/javascript,export const afterAll=()=>{};", shortCircuit: true, format: "module" };
    return next(spec, ctx);
  },
});

interface TuyChon {
  endpoint: string;
  container: string;
  web: string;
  pollMs: number;
  timeoutMs: number;
  lap: number;
  startNeuTat: boolean;
  khongDocker: boolean;
  /** R1b-2a T15 — thêm ô L1 (int CHƯA khai scale 1) */
  r1b2a: boolean;
  /** R1b-2b-1 T16 — thêm ô B1 (bool chặt trên coil + ghim STOP 1 trên coil kiểu int) */
  r1b2b1: boolean;
  /** R1b-2b-1 T17 — ô B1b qua proxy cắt liên kết ở FC5 đầu tiên (tái hiện có chủ đích STOP đang bay khi liên kết mất) */
  catLienKet: boolean;
  /** R1b-2b-1 T17 (chẩn đoán) — in từng đoạn / khung MBAP qua proxy */
  dumpProxy: boolean;
}
function docThamSo(argv: string[]): TuyChon {
  const lay = (k: string, mac: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : mac;
  };
  return {
    endpoint: lay("endpoint", "tcp://127.0.0.1:15502"),
    container: lay("container", "avi-openplc-bench"),
    web: lay("web", "http://127.0.0.1:18080"),
    pollMs: Number(lay("poll", "1000")),
    timeoutMs: Number(lay("timeout", "800")),
    lap: Math.max(1, Number(lay("lap", "3"))),
    startNeuTat: argv.includes("--start-neu-tat"),
    khongDocker: argv.includes("--khong-docker"),
    r1b2a: argv.includes("--r1b2a"),
    r1b2b1: argv.includes("--r1b2b1"),
    catLienKet: argv.includes("--cat-lien-ket"),
    dumpProxy: argv.includes("--dump-proxy"),
  };
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── DB _test (như vitest.setup.ts) ──
function docKhoaEnv(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1 || t.slice(0, i).trim() !== key) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}
function urlTest(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const dev = docKhoaEnv(duongDan(process.cwd(), ".env"), "DATABASE_URL");
  if (!dev) throw new Error("không tìm thấy DATABASE_URL trong .env");
  const u = new URL(dev);
  const devName = u.pathname.replace(/^\//, "");
  u.pathname = "/" + devName + "_test";
  const testName = u.pathname.replace(/^\//, "");
  if (!/test/i.test(testName) || testName === devName) throw new Error(`từ chối: DB "${testName}" phải chứa "test" và khác DB dev`);
  return u.toString();
}

// ── Docker + Modbus (khuôn scripts/scada-r1a-bench.ts) ──
function docker(...args: string[]): void {
  execFileSync("docker", args, { stdio: "ignore", timeout: 60_000 });
}
function trangThaiContainer(name: string): string {
  try {
    return execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" }).trim();
  } catch (e) {
    return `khong-doc-duoc (${String((e as Error).message).split("\n")[0].slice(0, 120)})`;
  }
}
const req = createRequire(import.meta.url);
const ModbusNs: any = req("modbus-serial");
const ModbusRTU: any = ModbusNs.default ?? ModbusNs;
const ServerTCP: any = ModbusNs.ServerTCP ?? ModbusNs.default?.ServerTCP;

function hostPort(endpoint: string): { host: string; port: number } {
  const u = new URL(endpoint.replace(/^tcp:/, "http:"));
  return { host: u.hostname, port: Number(u.port || 502) };
}
/** Một phiên client Modbus RIÊNG (kết nối mới) — oracle độc lập với driver của sản phẩm. */
async function voiClient<T>(endpoint: string, fn: (c: any) => Promise<T>, hanMs = 1500): Promise<T> {
  const { host, port } = hostPort(endpoint);
  const c = new ModbusRTU();
  try {
    await c.connectTCP(host, { port });
    c.setID(1);
    c.setTimeout(hanMs);
    return await fn(c);
  } finally {
    try {
      c._port?._client?.destroy?.();
      c.close(() => undefined);
    } catch {
      /* bỏ qua */
    }
  }
}
const docThanhGhi = (ep: string, reg0: number) => voiClient(ep, async (c) => Number((await c.readHoldingRegisters(reg0, 1)).data[0]));
const ghiThanhGhi = (ep: string, reg0: number, v: number) => voiClient(ep, async (c) => void (await c.writeRegister(reg0, v)));
/** R1b-2b-1 B1 — coil qua client riêng: FC01 đọc, FC05 ghi (coil0 = số 0-based; tag `coil:N` = coil N-1). */
const docCoil = (ep: string, coil0: number) => voiClient(ep, async (c) => Boolean((await c.readCoils(coil0, 1)).data[0]));
const ghiCoil = (ep: string, coil0: number, v: boolean) => voiClient(ep, async (c) => void (await c.writeCoil(coil0, v)));
const so01 = (b: boolean) => (b ? "1" : "0");

async function thamDo(endpoint: string): Promise<boolean> {
  try {
    return await voiClient(endpoint, async (c) => Array.isArray((await c.readHoldingRegisters(0, 18))?.data), 500);
  } catch {
    return false;
  }
}
async function batPlcQuaWeb(web: string): Promise<boolean> {
  try {
    const r = await fetch(web + "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=openplc&password=openplc",
      redirect: "manual",
    });
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return false;
    const s = await fetch(web + "/start_plc", { headers: { cookie }, redirect: "manual" });
    return s.status === 302 || s.status === 200;
  } catch {
    return false;
  }
}
async function doiModbusTraLoi(o: TuyChon, bamStartSauMs: number, hanMs = 90_000): Promise<boolean> {
  const t0 = Date.now();
  let daBam = false;
  let lanCuoi = 0;
  for (;;) {
    if (await thamDo(o.endpoint)) return daBam;
    const now = Date.now();
    if (now - t0 > hanMs) throw new Error(`Modbus ${o.endpoint} không trả lời sau ${hanMs} ms`);
    if (!o.khongDocker && now - t0 >= bamStartSauMs && now - lanCuoi >= 2000) {
      lanCuoi = now;
      if (await batPlcQuaWeb(o.web)) daBam = true;
    }
    await ngu(100);
  }
}

/** Bước 0 — thanh ghi 0..17 nào GIỮ giá trị ghi vào (runtime không ghi đè mỗi chu kỳ)? */
async function kiemGiuGiaTri(ep: string): Promise<Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }>> {
  const out: Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }> = [];
  for (let reg0 = 0; reg0 < 18; reg0++) {
    let goc = -1;
    const ghi = 12_000 + reg0;
    const doc: number[] = [];
    try {
      goc = await docThanhGhi(ep, reg0);
      await ghiThanhGhi(ep, reg0, ghi);
      let tr = 0;
      for (const moc of [200, 1000, 2500]) {
        await ngu(moc - tr);
        tr = moc;
        doc.push(await docThanhGhi(ep, reg0));
      }
      await ghiThanhGhi(ep, reg0, goc);
    } catch (e) {
      doc.push(Number.NaN);
      console.log(`[bench] bước 0: thanh ghi ${reg0} lỗi: ${(e as Error).message}`);
    }
    out.push({ reg0, goc, ghi, doc, giu: doc.length === 3 && doc.every((v) => v === ghi) });
  }
  return out;
}

/** Số coil bước 0b quét (`coil:1..16`). */
const SO_COIL_QUET = 16;
interface KetQuaGiuCoil {
  coil0: number;
  goc: boolean | null;
  /** 6 lần đọc: 3 sau khi ghi giá trị NGƯỢC gốc (+200/+1000/+2500 ms), 3 sau khi ghi lại gốc */
  doc: string[];
  giu: boolean;
  loi?: string;
}
/**
 * Bước 0b (R1b-2b-1 B1) — coil 0..SO_COIL_QUET-1 nào GIỮ giá trị ghi vào (chương trình PLC không lái mỗi chu kỳ)? Dừng ở coil ĐẦU TIÊN giữ cả
 * hai giá trị (chạm ít coil nhất). Mỗi coil thử: ghi !gốc, đọc +200/+1000/+2500 ms; ghi gốc, đọc +200/+1000/+2500 ms (đây cũng là bước trả gốc).
 */
async function kiemGiuCoil(ep: string): Promise<KetQuaGiuCoil[]> {
  const out: KetQuaGiuCoil[] = [];
  for (let coil0 = 0; coil0 < SO_COIL_QUET; coil0++) {
    let goc: boolean | null = null;
    const doc: boolean[] = [];
    let loi: string | undefined;
    try {
      goc = await docCoil(ep, coil0);
      for (const ghi of [!goc, goc]) {
        await ghiCoil(ep, coil0, ghi);
        let tr = 0;
        for (const moc of [200, 1000, 2500]) {
          await ngu(moc - tr);
          tr = moc;
          doc.push(await docCoil(ep, coil0));
        }
      }
    } catch (e) {
      loi = (e as Error).message;
      console.log(`[bench] bước 0b: coil ${coil0} lỗi: ${loi}`);
      if (goc !== null) await ghiCoil(ep, coil0, goc).catch(() => undefined);
    }
    const giu = goc !== null && doc.length === 6 && doc.slice(0, 3).every((v) => v === !goc) && doc.slice(3).every((v) => v === goc);
    out.push({ coil0, goc, doc: doc.map(so01), giu, ...(loi ? { loi } : {}) });
    if (giu) break;
  }
  return out;
}

// ── Safety PLC giả trong tiến trình (khuôn scripts/safety-plc-bench.ts selfServer) ──
async function safetyPlcGia(): Promise<{ port: number; coils: Map<number, boolean>; close(): Promise<void> }> {
  const coils = new Map<number, boolean>();
  const srv = new ServerTCP(
    {
      getCoil: (a: number) => coils.get(a) ?? false,
      getDiscreteInput: () => false,
      getHoldingRegister: () => 0,
      getInputRegister: () => 0,
      setCoil: () => undefined,
      setRegister: () => undefined,
    },
    { host: "127.0.0.1", port: "0", unitID: 1 },
  );
  await new Promise<void>((res, rej) => {
    srv.once("initialized", () => res());
    srv.once("serverError", rej);
  });
  const port = srv._server.address().port as number;
  return {
    port,
    coils,
    close: () =>
      new Promise<void>((res) => {
        for (const s of srv?.socks?.keys?.() ?? []) (s as any).destroy();
        srv.close(() => res());
      }),
  };
}

interface Dong {
  lap: number;
  o: string;
  buoc: string;
  mong: string;
  duoc: string;
  ms: number;
  thanhGhi: string;
  dat: boolean;
}

/** Giá trị "đang chạy" của thanh ghi dừng trước mỗi STOP (khác ghim 0, trong dải 0..100). */
const DANG_CHAY = 77;

async function main(): Promise<void> {
  const o = docThamSo(process.argv.slice(2));
  const RUN = `r1bbench${process.pid}${Date.now().toString(36)}`;

  // ── container: GHI trạng thái; không running ⇒ KHÔNG chạy (mặc định) ──
  let banDau = "khong-docker";
  if (!o.khongDocker) {
    banDau = trangThaiContainer(o.container);
    let anh = "?";
    let ver = "?";
    try {
      anh = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}} {{.Image}} created={{.Created}} exit={{.State.ExitCode}} finished={{.State.FinishedAt}}", o.container], { encoding: "utf8" }).trim();
      ver = execFileSync("docker", ["version", "-f", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
    } catch (e) {
      anh = `khong-doc-duoc (${String((e as Error).message).split("\n")[0].slice(0, 120)})`;
    }
    console.log(`[bench] container ${o.container}: trạng thái ban đầu=${banDau}; ${anh}; Docker engine ${ver}`);
    if (banDau !== "running" && !o.startNeuTat) {
      console.log(`[bench] bench not run — container unavailable (trạng thái "${banDau}", không --start-neu-tat: container dùng chung, không khởi động)`);
      process.exitCode = 3;
      return;
    }
  }
  if (banDau === "running" || o.khongDocker) {
    const traLoi = await thamDo(o.endpoint);
    console.log(`[bench] thăm dò Modbus ${o.endpoint}: ${traLoi ? "trả lời" : "KHÔNG trả lời"}`);
    if (!traLoi && !o.startNeuTat) {
      console.log(`[bench] bench not run — container unavailable (Modbus ${o.endpoint} không trả lời; trạng thái "${banDau}")`);
      process.exitCode = 3;
      return;
    }
  }

  // Cờ — đặt TRƯỚC mọi import của server. .env KHÔNG được nạp.
  const CO: Record<string, string> = {
    DATABASE_URL: urlTest(),
    NODE_ENV: "test",
    DB_POOL_MAX: "4",
    DB_POOL_MAX_JOBS: "2",
    DB_POOL_MAX_READ: "2",
    EXTERNAL_MQTT_ENABLED: "false",
    OT_GATEWAY_ENABLED: "true",
    OT_CONN_HA_ENABLED: "false",
    OT_CHAT_LUONG_V2_ENABLED: "true",
    OT_GHI_TRANG_THAI_ADAPTER_ENABLED: "false",
    OT_STORE_FORWARD_ENABLED: "false",
    OT_POLL_BATCH_ENABLED: "false",
    OT_TAG_DEADBAND_ENABLED: "false",
    OT_INGEST_TO_UNS: "false",
    SCADA_LIVE_CACHE_ENABLED: "true",
    SCADA_SOCKET_ENABLED: "false",
    SCADA_COMMANDS_ENABLED: "true",
    SCADA_CONG_CHE_DO_ENABLED: "false", // cổng chế độ 3c vẫn chạy cho hmi.* — không nhờ cờ
    OT_CONTROL_ENABLED: "true", // D9: chỉ trong tiến trình bench
    AI_OT_CONTROL_ENABLED: "false",
    OT_COMMISSIONING_REQUIRED: "true",
    OT_SAFETY_PREFLIGHT_ENABLED: "true",
    SAFETY_PLC_ADAPTER_ENABLED: "true",
    OT_READBACK_ENABLED: "false", // HMI vẫn đọc lại (docLai bat_buoc)
    OT_CMD_SERIALIZE_ENABLED: "false",
    SEC_PLATFORM: "false",
    UNS_CMD_ACK_ENABLED: "false",
    INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  };
  for (const [k, v] of Object.entries(CO)) process.env[k] = v;
  console.log(`[bench] DB: ${new URL(CO.DATABASE_URL).pathname.slice(1)} · cờ: ${Object.entries(CO).filter(([k]) => k !== "DATABASE_URL").map(([k, v]) => `${k}=${v}`).join(" ")}`);

  if (!o.khongDocker) {
    if (banDau === "paused") docker("unpause", o.container);
    else if (banDau !== "running") docker("start", o.container);
  }

  const bang: Dong[] = [];
  /** R1b-2b-1 T17 (chẩn đoán) — ghi dòng VÀ in ngay (lần chạy bị huỷ sau đó vẫn để lại bằng chứng từng bước). */
  const themDong = (d: Dong): void => {
    bang.push(d);
    console.log(`[bench] dòng | ${d.lap} | ${d.o} | ${d.buoc} | ${d.duoc} | ${d.ms} ms | ${d.thanhGhi} | ${d.dat ? "ĐẠT" : "KHÔNG ĐẠT"}`);
  };
  /** Lỗi của MỘT bước ⇒ một dòng ĐỎ có lý do + stack in ra; lượt chạy tiếp (không huỷ cả lần chạy). */
  const ghiLoiBuoc = (lap: number, o2: string, e: unknown): void => {
    const err = e as Error;
    // lỗi của modbus-serial là object thường (không phải Error, không có stack) ⇒ inspect + stack của chỗ bắt
    console.error(`[bench] LỖI BƯỚC lượt ${lap} ô ${o2}: ${err?.stack ?? inspect(e)}${err?.stack ? "" : `
  (bắt tại) ${new Error("vị trí bắt").stack}`}`);
    themDong({ lap, o: o2, buoc: "LỖI BƯỚC — bước bỏ dở, lượt chạy tiếp", mong: "bước chạy hết", duoc: `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`, ms: 0, thanhGhi: "-", dat: false });
  };
  const buoc = async (lap: number, o2: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      ghiLoiBuoc(lap, o2, e);
    }
  };
  const don: Array<() => Promise<unknown>> = [];
  try {
    const daBam = await doiModbusTraLoi(o, 3000);
    console.log(`[bench] Modbus ${o.endpoint} trả lời${daBam ? " (đã bấm Start qua web)" : ""}`);

    // ── trạng thái cũ của MỌI thanh ghi sẽ chạm (0..17) — trả lại cuối cùng ──
    const goc: number[] = [];
    for (let r = 0; r < 18; r++) goc.push(await docThanhGhi(o.endpoint, r));
    console.log(`[bench] giá trị gốc holding reg 0..17: ${goc.join(",")}`);
    don.push(async () => {
      for (let r = 0; r < 18; r++) await ghiThanhGhi(o.endpoint, r, goc[r]);
      const sau: number[] = [];
      for (let r = 0; r < 18; r++) sau.push(await docThanhGhi(o.endpoint, r));
      console.log(`[bench] trả lại holding reg 0..17: ${sau.join(",")} ⇒ ${sau.every((v, i) => v === goc[i]) ? "KHỚP gốc" : "LỆCH gốc"}`);
    });

    // ── BƯỚC 0 ──
    const giu = await kiemGiuGiaTri(o.endpoint);
    for (const g of giu) console.log(`[bench] bước 0: holding reg ${g.reg0} (tag holding:${g.reg0 + 1}) gốc=${g.goc} ghi=${g.ghi} đọc@200/1000/2500ms=${g.doc.join("/")} ⇒ ${g.giu ? "GIỮ" : "KHÔNG GIỮ"}`);
    const dungDuoc = giu.filter((g) => g.giu);
    const canSo = o.r1b2a ? 4 : 3;
    if (dungDuoc.length < canSo) {
      throw new Error(`bước 0: cần ≥ ${canSo} thanh ghi giữ giá trị (dừng + chế độ + X2${o.r1b2a ? " + L1" : ""}), có ${dungDuoc.length} — bench KHÔNG đo được`);
    }
    const REG_DUNG = dungDuoc[0].reg0;
    const REG_CHE_DO = dungDuoc[1].reg0;
    const REG_SC10 = dungDuoc[2].reg0;
    const REG_SC1 = o.r1b2a ? dungDuoc[3].reg0 : -1;
    console.log(
      `[bench] dùng: dừng (ghim 0) = reg ${REG_DUNG} (holding:${REG_DUNG + 1}), chế độ = reg ${REG_CHE_DO} (holding:${REG_CHE_DO + 1}), X2 int scale 10 = reg ${REG_SC10} (holding:${REG_SC10 + 1})` +
        (o.r1b2a ? `, L1 int scale 1 chưa khai = reg ${REG_SC1} (holding:${REG_SC1 + 1})` : ""),
    );
    await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2); // REMOTE
    await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
    await ghiThanhGhi(o.endpoint, REG_SC10, 0);
    if (o.r1b2a) await ghiThanhGhi(o.endpoint, REG_SC1, 0);

    // ── BƯỚC 0b (R1b-2b-1 B1): coil nào GIỮ giá trị? ──
    let COIL_B1 = -1;
    let gocCoilB1 = false;
    let b1KhongDo = "";
    if (o.r1b2b1) {
      const giuCoil = await kiemGiuCoil(o.endpoint);
      for (const g of giuCoil) {
        console.log(
          `[bench] bước 0b: coil ${g.coil0} (tag coil:${g.coil0 + 1}) gốc=${g.goc === null ? "?" : so01(g.goc)} ghi ${g.goc === null ? "?" : so01(!g.goc)} đọc@200/1000/2500ms=${g.doc.slice(0, 3).join("/")}` +
            ` · ghi lại ${g.goc === null ? "?" : so01(g.goc)} đọc=${g.doc.slice(3).join("/")}${g.loi ? ` · lỗi ${g.loi}` : ""} ⇒ ${g.giu ? "GIỮ" : "KHÔNG GIỮ"}`,
        );
      }
      const chon = giuCoil.find((g) => g.giu);
      if (!chon || chon.goc === null) {
        b1KhongDo = `bước 0b: 0/${giuCoil.length} coil (coil:1..${SO_COIL_QUET}) giữ giá trị — ${giuCoil.map((g) => `coil ${g.coil0}: ${g.doc.join("/") || "-"}${g.loi ? ` lỗi` : ""}`).join("; ")}`;
        console.log(`[bench] bench B1 not measurable — ${b1KhongDo}`);
      } else {
        COIL_B1 = chon.coil0;
        gocCoilB1 = chon.goc;
        console.log(`[bench] dùng: B1 coil ${COIL_B1} (coil:${COIL_B1 + 1}), gốc = ${so01(gocCoilB1)}`);
        don.push(async () => {
          await ghiCoil(o.endpoint, COIL_B1, gocCoilB1);
          const sau = await docCoil(o.endpoint, COIL_B1);
          console.log(`[bench] trả lại coil ${COIL_B1}: ${so01(sau)} ⇒ ${sau === gocCoilB1 ? "KHỚP gốc" : "LỆCH gốc"}`);
        });
      }
    }
    const coB1 = o.r1b2b1 && COIL_B1 >= 0;

    // ── server ──
    await import("../server/services/ot"); // đăng ký driver
    const [{ getDb }, { sql }, schema, { taoNguoiDungTest, donNguoiDungTest }, { acquireSeedExclusive }] = await Promise.all([
      import("../server/db/connection"),
      import("drizzle-orm"),
      import("../drizzle/schema"),
      import("../server/testing/nguoiDungTest"),
      import("../server/services/edge/__edgeSeedGuard.dot10"),
    ]);
    const [{ setAdapterSource }, { createDriver }, ot, boDem, { setTelemetryPersistFn }, disp, binding, { scadaCommandsRouter }] = await Promise.all([
      import("../server/services/ot/deviceAdapter"),
      import("../server/services/ot/driverRegistry"),
      import("../server/services/ot/otManager"),
      import("../server/services/scada/boDemHienTai"),
      import("../server/services/telemetryBus"),
      import("../server/services/ot/commandDispatcher"),
      import("../server/services/ot/otActionBinding"),
      import("../server/routers/scadaCommandsRouter"),
      import("../server/services/ot/adapterFacade"),
      import("../server/services/safety/plc/safetyPlcAdapter"),
    ]);
    const db = await getDb();
    if (!db) throw new Error("không nối được CSDL _test");
    const dung1 = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

    const seed = await acquireSeedExclusive(CO.DATABASE_URL, { waitMs: 30_000 });
    don.push(() => seed.release());
    let soHangTelemetry = 0;
    setTelemetryPersistFn(async (rows) => {
      soHangTelemetry += rows.length;
      return rows.length;
    });
    don.push(async () => setTelemetryPersistFn(null));

    const plc = await safetyPlcGia();
    don.push(() => plc.close());

    const code = RUN;
    const [f] = await dung1(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    const [w] = await dung1(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
    const [l] = await dung1(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
    const [s] = await dung1(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
    const [m] = await dung1(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, 'May bench R1b-1', 'AOI', true) RETURNING id`);
    const machineId = Number(m.id);
    don.push(async () => {
      await dung1(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung1(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung1(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung1(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung1(sql`DELETE FROM factories WHERE code = ${code}`);
    });
    const maPlc = `${RUN}-splc`.slice(0, 64);
    await dung1(sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, scope, "stationId")
      VALUES (${maPlc}, 'R1b-1 bench safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
        ${JSON.stringify({ estop: { address: "coil:1", dataType: "bool" } })}::jsonb, true, NULL, ${s.id})`);
    don.push(() => dung1(sql`DELETE FROM safety_plc_configs WHERE code = ${maPlc}`));

    const [a] = await dung1(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "connectionOptions")
      VALUES (${machineId}, ${RUN}, ${RUN}, 'modbus', ${o.endpoint}, ${o.pollMs}, true, 'disabled', ${JSON.stringify({ unitId: 1, timeoutMs: o.timeoutMs })}::json) RETURNING id`);
    const adapterId = Number(a.id);
    don.push(async () => {
      await dung1(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${adapterId}`);
      await dung1(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${machineId}`);
      await dung1(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`);
      await dung1(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${adapterId}`).catch(() => undefined);
      await dung1(sql`DELETE FROM device_adapters WHERE id = ${adapterId}`);
    });
    await dung1(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${adapterId}, 'active', 1, ${RUN})`);
    const tagDung = `holding:${REG_DUNG + 1}`;
    const tagCheDo = `holding:${REG_CHE_DO + 1}`;
    const tagSc10 = `holding:${REG_SC10 + 1}`;
    await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled", channel_kind, display_name,
        write_min, write_max, write_step, actuation_level, stop_value, stop_pinned_by, stop_pinned_at)
      VALUES (${adapterId}, 'dung', ${tagDung}, 'int', 1, true, true, 'input_output'::scada_channel_kind, 'Dung bench (ghim 0)', 0, 100, 1, 1, '0'::jsonb, '1', now()),
             (${adapterId}, 'che_do', ${tagCheDo}, 'int', 1, false, true, 'input'::scada_channel_kind, 'Che do may', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
             (${adapterId}, 'sc10cu', ${tagSc10}, 'int', 10, true, true, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);
    const tagSc1 = `holding:${REG_SC1 + 1}`;
    if (o.r1b2a) {
      // R1b-2a L1 — int CHƯA khai (mọi cột 0431 NULL), scale 1
      await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled")
        VALUES (${adapterId}, 'sc1cu', ${tagSc1}, 'int', 1, true, true)`);
    }
    const tagCoil = `coil:${COIL_B1 + 1}`;
    let machineB1 = -1;
    let adapterB1 = -1;
    // R1b-2b-1 T17 — `--cat-lien-ket`: adapter B1b đi qua proxy cắt liên kết (adapter bench chính vẫn nối thẳng)
    const proxy = coB1 && o.catLienKet ? await taoProxyModbus(o.endpoint, o.dumpProxy ? { dump: (d) => console.log(d) } : {}) : null;
    if (proxy) don.push(() => proxy.close());
    const endpointB1 = proxy ? `tcp://127.0.0.1:${proxy.port}` : o.endpoint;
    if (o.catLienKet && !coB1) console.log("[bench] --cat-lien-ket bỏ qua: không có ô B1 (cần --r1b2b1 và một coil giữ giá trị)");
    if (proxy) console.log(`[bench] --cat-lien-ket: adapter B1b nối qua proxy ${endpointB1} ⇒ ${o.endpoint}`);
    if (coB1) {
      // R1b-2b-1 B1a — bool CHƯA khai (mọi cột 0431 NULL) trên coil, adapter bench
      await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled")
        VALUES (${adapterId}, 'bcoil', ${tagCoil}, 'bool', 1, true, true)`);
      // R1b-2b-1 B1b — MÁY + ADAPTER RIÊNG (cùng trạm, cùng endpoint): tag INT trên CÙNG coil, ghim STOP 1 mức 1 (xem đầu tệp vì sao tách máy)
      const maB1 = `${RUN}b1`;
      const [m2] = await dung1(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${maB1}, 'May bench R1b-2b-1 B1b', 'AOI', true) RETURNING id`);
      machineB1 = Number(m2.id);
      don.push(() => dung1(sql`DELETE FROM machines WHERE code = ${maB1}`));
      const [a2] = await dung1(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "connectionOptions")
        VALUES (${machineB1}, ${maB1}, ${maB1}, 'modbus', ${endpointB1}, ${o.pollMs}, true, 'disabled', ${JSON.stringify({ unitId: 1, timeoutMs: o.timeoutMs })}::json) RETURNING id`);
      adapterB1 = Number(a2.id);
      don.push(async () => {
        await dung1(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${adapterB1}`);
        await dung1(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterB1}`);
        await dung1(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${adapterB1}`).catch(() => undefined);
        await dung1(sql`DELETE FROM device_adapters WHERE id = ${adapterB1}`);
      });
      await dung1(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${adapterB1}, 'active', 1, ${maB1})`);
      await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled", channel_kind, display_name,
          write_min, write_max, write_step, actuation_level, stop_value, stop_pinned_by, stop_pinned_at)
        VALUES (${adapterB1}, 'icoil', ${tagCoil}, 'int', 1, true, true, 'input_output'::scada_channel_kind, 'Coil int bench (ghim 1)', 0, 1, 1, 1, '1'::jsonb, '1', now())`);
    }
    await dung1(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${machineId}, ${adapterId}, 'che_do', '2'::jsonb, 1)`);

    const admin = await taoNguoiDungTest("admin", "admin", { tienTo: "r1bbench", ts: RUN, ten: "R1b-1 bench admin" });
    don.push(() => dung1(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${admin.id}`));
    don.push(() => donNguoiDungTest());
    const caller = scadaCommandsRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: admin.twoFactorEnabled === true } } as never);

    setAdapterSource(async () => [
      {
        adapterId,
        code: RUN,
        machineId,
        protocol: "modbus" as const,
        connection: { endpoint: o.endpoint, timeoutMs: o.timeoutMs, options: { unitId: 1, timeoutMs: o.timeoutMs } },
        pollIntervalMs: o.pollMs,
        tags: [
          { tagKey: "dung", address: tagDung, dataType: "int" as const },
          { tagKey: "che_do", address: tagCheDo, dataType: "int" as const },
          { tagKey: "sc10cu", address: tagSc10, dataType: "int" as const, scale: 10 },
          ...(o.r1b2a ? [{ tagKey: "sc1cu", address: tagSc1, dataType: "int" as const }] : []),
          ...(coB1 ? [{ tagKey: "bcoil", address: tagCoil, dataType: "bool" as const }] : []),
        ],
        driver: createDriver("modbus"),
      } as never,
      ...(coB1
        ? [
            {
              adapterId: adapterB1,
              code: `${RUN}b1`,
              machineId: machineB1,
              protocol: "modbus" as const,
              connection: { endpoint: endpointB1, timeoutMs: o.timeoutMs, options: { unitId: 1, timeoutMs: o.timeoutMs } },
              pollIntervalMs: o.pollMs,
              tags: [{ tagKey: "icoil", address: tagCoil, dataType: "int" as const }],
              driver: createDriver("modbus"),
            } as never,
          ]
        : []),
    ]);
    if (!(await ot.startOt())) throw new Error("startOt trả false");
    don.push(async () => {
      await ot.stopOt();
      setAdapterSource(null);
      boDem.xoaAdapter(adapterId);
      if (coB1) boDem.xoaAdapter(adapterB1);
    });
    const doiDen = async (dk: () => boolean, hanMs: number) => {
      const t0 = Date.now();
      while (!dk()) {
        if (Date.now() - t0 > hanMs) return null;
        await ngu(20);
      }
      return Date.now() - t0;
    };
    const cheDoLa = (v: number) => () => {
      const g = boDem.layGiaTri(adapterId, "che_do");
      return !!g && g.q === "good" && !g.stale && g.v === v;
    };
    if ((await doiDen(cheDoLa(2), 30_000)) === null) throw new Error(`kênh chế độ không lên good=2 trong 30 s: ${JSON.stringify(boDem.layGiaTri(adapterId, "che_do"))}`);
    console.log("[bench] OT lên: kênh chế độ good = 2 (REMOTE) qua vòng poll THẬT");

    const lenhAi = async (commandType: string, writes: Array<{ tagKey: string; value: unknown }>) => {
      const actionId = `${RUN}-ai-${randomUUID()}`;
      await db.insert(schema.aiPendingActions).values({
        id: actionId,
        tool: "set_machine_param",
        argsJson: {},
        userId: admin.id,
        userRole: "admin",
        summary: `${RUN} AI`,
        previewJson: binding.withOtPayloadHash({ entityType: "machine" }, binding.otPayloadHash({ tool: "set_machine_param", adapterId, machineId, commandType, writes })),
        status: "confirmed",
        idempotencyKey: `${actionId}-idem`,
        expiresAt: new Date(Date.now() + 600_000),
      });
      return {
        adapterId,
        machineId,
        commandType,
        writes,
        triggeredBy: { kind: "hitl" as const, actionId, tool: "set_machine_param", confirmedBy: admin.id, requestedBy: admin.id },
        idempotencyKey: `${RUN}-ai-${randomUUID()}`,
      };
    };
    const maLoi = (e: unknown) => {
      const x = e as { cause?: { appCode?: string; appParams?: { ma?: string; lyDo?: string } } };
      return `${x.cause?.appParams?.ma ?? x.cause?.appCode ?? String(e)}${x.cause?.appParams?.lyDo ? ` (${x.cause.appParams.lyDo})` : ""}`;
    };
    const demLenh = async () => Number((await dung1(sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${adapterId}`))[0].n);

    /** STOP HMI một lần: thanh ghi dừng đặt về "đang chạy", bấm dungMay, đọc lại độc lập. */
    const stopHmi = async (lap: number, o2: string, nhan: string) => {
      await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
      const truoc = await docThanhGhi(o.endpoint, REG_DUNG);
      const n0 = await demLenh();
      const t0 = Date.now();
      let duoc = "";
      let dat = false;
      try {
        const kq = await caller.dungMay({ machineId, clientRequestId: randomUUID() });
        const r = kq.ketQua[0];
        duoc = `${r?.status} ok=${r?.ok}${r?.reason ? ` ${r.reason}` : ""} · ${kq.ketQua.length} adapter`;
        dat = kq.ketQua.length === 1 && r.status === "acked_verified" && r.ok === true && r.simulated === false;
      } catch (e) {
        duoc = `NÉM ${maLoi(e)}`;
      }
      const ms = Date.now() - t0;
      const sau = await docThanhGhi(o.endpoint, REG_DUNG);
      const n1 = await demLenh();
      themDong({ lap, o: o2, buoc: nhan, mong: "acked_verified, thanh ghi dừng = ghim 0", duoc: `${duoc} · command_log +${n1 - n0}`, ms, thanhGhi: `${truoc} → ${sau}`, dat: dat && sau === 0 && truoc === DANG_CHAY });
    };

    for (let lap = 1; lap <= o.lap; lap++) {
      // ── S1: STOP HMI ở REMOTE ──
      await buoc(lap, "S1", () => stopHmi(lap, "S1", "STOP HMI, máy REMOTE (chế độ = 2)"));

      // ── S2: máy LOCAL (kênh chế độ ≠ 2, đọc từ PLC qua vòng poll THẬT) ──
      await buoc(lap, "S2", async () => {
      await ghiThanhGhi(o.endpoint, REG_CHE_DO, 1);
      const msThay = await doiDen(cheDoLa(1), 10_000);
      if (msThay === null) throw new Error("kênh chế độ không về 1 trong 10 s");
      {
        // đối chứng: lệnh ghi thường ở LOCAL bị cổng chế độ chặn
        await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
        const truoc = await docThanhGhi(o.endpoint, REG_DUNG);
        const t0 = Date.now();
        let duoc = "";
        try {
          await caller.request({ adapterId, tagKey: "dung", value: 50, lyDo: "bench R1b-1 doi chung LOCAL", clientRequestId: randomUUID() });
          duoc = "THÀNH CÔNG (sai)";
        } catch (e) {
          duoc = maLoi(e);
        }
        const ms = Date.now() - t0;
        const sau = await docThanhGhi(o.endpoint, REG_DUNG);
        themDong({ lap, o: "S2-ĐC", buoc: `request dung=50 ở LOCAL (chế độ=1 thấy sau ${msThay} ms)`, mong: "MODE_LOCAL, thanh ghi không đổi", duoc, ms, thanhGhi: `${truoc} → ${sau}`, dat: duoc.startsWith("MODE_LOCAL") && sau === truoc });
      }
      await stopHmi(lap, "S2", "STOP HMI, máy LOCAL (chế độ = 1)");
      await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2);
      if ((await doiDen(cheDoLa(2), 10_000)) === null) throw new Error("kênh chế độ không về 2 trong 10 s");
      });

      // ── X2: tag int CHƯA khai scale 10 — 25 ⇒ OFF_STEP; 30 ⇒ số thô 3 trên PLC ──
      await buoc(lap, "X2", async () => {
        await ghiThanhGhi(o.endpoint, REG_SC10, 0);
        const n0 = await demLenh();
        const t0 = Date.now();
        const r25 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 25 }]));
        const ms = Date.now() - t0;
        const sau25 = await docThanhGhi(o.endpoint, REG_SC10);
        const n1 = await demLenh();
        const goiY = (r25.appError?.appParams as { goiY?: unknown } | undefined)?.goiY;
        themDong({ lap, o: "X2", buoc: "dispatch AI sc10cu=25 (int chưa khai, scale 10)", mong: "rejected OFF_STEP goiY 30, command_log +1, thanh ghi không đổi", duoc: `${r25.status} ${r25.reason ?? ""} goiY=${String(goiY)} · command_log +${n1 - n0}`, ms, thanhGhi: `0 → ${sau25}`, dat: r25.status === "rejected" && r25.reason === "OFF_STEP" && goiY === 30 && n1 - n0 === 1 && sau25 === 0 });

        const t1 = Date.now();
        const r30 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 30 }]));
        const ms2 = Date.now() - t1;
        const sau30 = await docThanhGhi(o.endpoint, REG_SC10);
        themDong({ lap, o: "X2", buoc: "dispatch AI sc10cu=30", mong: "gửi, thanh ghi = số thô 3", duoc: `${r30.status} ok=${r30.ok}`, ms: ms2, thanhGhi: `0 → ${sau30}`, dat: r30.ok === true && r30.simulated === false && sau30 === 3 });
      });

      // ── R1b-2a L1: tag int CHƯA khai scale 1 — 2,5 ⇒ OFF_STEP goiY 3; "abc" ⇒ TYPE_MISMATCH; 3 ⇒ thanh ghi = 3 ──
      if (o.r1b2a) await buoc(lap, "L1", async () => {
        await ghiThanhGhi(o.endpoint, REG_SC1, 0);
        for (const [v, ma] of [
          [2.5, "OFF_STEP"],
          ["abc", "TYPE_MISMATCH"],
        ] as const) {
          const truoc = await docThanhGhi(o.endpoint, REG_SC1);
          const n0 = await demLenh();
          const t0 = Date.now();
          const r = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc1cu", value: v }]));
          const ms = Date.now() - t0;
          const sau = await docThanhGhi(o.endpoint, REG_SC1);
          const n1 = await demLenh();
          const goiY = (r.appError?.appParams as { goiY?: unknown } | undefined)?.goiY;
          const mongGoiY = ma === "OFF_STEP" ? goiY === 3 : true;
          themDong({
            lap,
            o: "L1",
            buoc: `dispatch AI sc1cu=${JSON.stringify(v)} (int chưa khai, scale 1)`,
            mong: `rejected ${ma}${ma === "OFF_STEP" ? " goiY 3" : ""}, command_log +1, thanh ghi không đổi`,
            duoc: `${r.status} ${r.reason ?? ""}${goiY !== undefined ? ` goiY=${String(goiY)}` : ""} · command_log +${n1 - n0}`,
            ms,
            thanhGhi: `${truoc} → ${sau}`,
            dat: r.status === "rejected" && r.reason === ma && mongGoiY && n1 - n0 === 1 && sau === truoc,
          });
        }
        const truoc = await docThanhGhi(o.endpoint, REG_SC1);
        const t1 = Date.now();
        const r3 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc1cu", value: 3 }]));
        const ms3 = Date.now() - t1;
        const sau3 = await docThanhGhi(o.endpoint, REG_SC1);
        themDong({ lap, o: "L1", buoc: "dispatch AI sc1cu=3", mong: "gửi, thanh ghi = 3", duoc: `${r3.status} ok=${r3.ok}`, ms: ms3, thanhGhi: `${truoc} → ${sau3}`, dat: r3.ok === true && r3.simulated === false && sau3 === 3 });
      });

      // ── R1b-2b-1 B1: bool chặt trên coil (B1a) + ghim STOP 1 trên coil kiểu INT qua STOP HMI (B1b, điều kiện 1c) ──
      if (o.r1b2b1 && !coB1) {
        themDong({ lap, o: "B1", buoc: "bước 0b: tìm coil giữ giá trị", mong: "≥ 1 coil giữ giá trị", duoc: `bench B1 not measurable — ${b1KhongDo}`, ms: 0, thanhGhi: "-", dat: false });
      } else if (coB1) {
        const coilTxt = (a: boolean, b: boolean) => `coil ${so01(a)} → ${so01(b)}`;
        await buoc(lap, "B1a", async () => {
        // B1a — "false" / "0" ⇒ coil 0 (coil đặt 1 trước bằng client riêng)
        for (const v of ["false", "0"]) {
          await ghiCoil(o.endpoint, COIL_B1, true);
          const truoc = await docCoil(o.endpoint, COIL_B1);
          const n0 = await demLenh();
          const t0 = Date.now();
          const r = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "bcoil", value: v }]));
          const ms = Date.now() - t0;
          const sau = await docCoil(o.endpoint, COIL_B1);
          const n1 = await demLenh();
          themDong({
            lap,
            o: "B1a",
            buoc: `dispatch AI bcoil=${JSON.stringify(v)} (bool chưa khai, coil:${COIL_B1 + 1})`,
            mong: "gửi, coil = 0",
            duoc: `${r.status} ok=${r.ok}${r.reason ? ` ${r.reason}` : ""} · command_log +${n1 - n0}`,
            ms,
            thanhGhi: coilTxt(truoc, sau),
            dat: r.ok === true && r.simulated === false && truoc === true && sau === false,
          });
        }
        // B1a — "off" (coil đặt 1: bản lỏng "off"⇒FALSE sẽ đổi coil) / 2 (coil đặt 0: bản lỏng Boolean(2)=TRUE sẽ đổi coil) ⇒ TYPE_MISMATCH
        for (const [v, datTruoc] of [
          ["off", true],
          [2, false],
        ] as const) {
          await ghiCoil(o.endpoint, COIL_B1, datTruoc);
          const truoc = await docCoil(o.endpoint, COIL_B1);
          const n0 = await demLenh();
          const t0 = Date.now();
          const r = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "bcoil", value: v }]));
          const ms = Date.now() - t0;
          const sau = await docCoil(o.endpoint, COIL_B1);
          const n1 = await demLenh();
          const ae = r.appError as { appCode?: string; appParams?: { ma?: string } } | undefined;
          themDong({
            lap,
            o: "B1a",
            buoc: `dispatch AI bcoil=${JSON.stringify(v)} (coil đặt ${so01(datTruoc)} trước)`,
            mong: "rejected TYPE_MISMATCH (appError SCADA_VALUE_TYPE_MISMATCH), command_log +1, coil không đổi",
            duoc: `${r.status} ${r.reason ?? ""} ${ae?.appCode ?? "-"} · command_log +${n1 - n0}`,
            ms,
            thanhGhi: coilTxt(truoc, sau),
            dat:
              r.status === "rejected" &&
              r.reason === "TYPE_MISMATCH" &&
              ae?.appCode === "SCADA_VALUE_TYPE_MISMATCH" &&
              n1 - n0 === 1 &&
              truoc === datTruoc &&
              sau === truoc,
          });
        }
        });
        // R1b-2b-1 T17 (chẩn đoán bench OpenPLC bị huỷ, điều phối) — ĐỐI CHỨNG chạy TRƯỚC mọi ô cắt: proxy THÔNG SUỐT (không cắt). b1 poll 5 s qua proxy
        // (không rớt, mẫu good), rồi STOP HMI máy B1b qua proxy ⇒ acked_verified coil 0 → 1; mọi yêu cầu qua proxy được trả lời. ĐỎ trên OpenPLC thật ⇒
        // lỗi ở công cụ (proxy); XANH ⇒ proxy trung thực — b1 rớt poll trước đây phải tìm ở đường nối lại của sản phẩm qua proxy / OpenPLC khựng.
        if (proxy && lap === 1) await buoc(lap, "B1b-thông", async () => {
          proxy.datLaiThongKe();
          const msNoi = await doiDen(() => ot.getActiveDriver(adapterB1)?.isConnected() === true, 15_000);
          let mauTot = 0;
          let mauXau = 0;
          let rot = 0;
          let dangNoi = ot.getActiveDriver(adapterB1)?.isConnected() === true;
          const tQuan = Date.now();
          while (Date.now() - tQuan < 5000) {
            await ngu(200);
            const g = boDem.layGiaTri(adapterB1, "icoil");
            if (g && g.q === "good" && !g.stale) mauTot += 1;
            else mauXau += 1;
            const noi = ot.getActiveDriver(adapterB1)?.isConnected() === true;
            if (dangNoi && !noi) rot += 1;
            dangNoi = noi;
          }
          await ghiCoil(o.endpoint, COIL_B1, false);
          const truoc = await docCoil(o.endpoint, COIL_B1);
          const t0 = Date.now();
          let st = "";
          let okR: boolean | undefined;
          let duocStop = "";
          try {
            const kq = await caller.dungMay({ machineId: machineB1, clientRequestId: randomUUID() });
            const r = kq.ketQua[0];
            st = String(r?.status);
            okR = r?.ok;
            duocStop = `${r?.status} ok=${r?.ok}${r?.reason ? ` ${r.reason}` : ""}`;
          } catch (e) {
            duocStop = `NÉM ${maLoi(e)}`;
          }
          const ms = Date.now() - t0;
          const sau = await docCoil(o.endpoint, COIL_B1);
          await ngu(1100); // để mọi yêu cầu còn bay kịp được trả lời trước khi đếm "treo > 1 s"
          const tk = proxy.thongKe();
          console.log(`[bench] B1b-thông lượt ${lap}: b1 nối sau ${msNoi ?? "KHÔNG"} ms; thống kê proxy ${JSON.stringify(tk)}`);
          themDong({
            lap,
            o: "B1b-thông",
            buoc: "ĐỐI CHỨNG proxy THÔNG SUỐT (không cắt): b1 poll 5 s qua proxy + STOP HMI máy B1b",
            mong: "b1 không rớt, mẫu icoil good, acked_verified, coil 0 → 1, mọi yêu cầu qua proxy được trả lời",
            duoc:
              `rớt ${rot}, mẫu tốt ${mauTot}/${mauTot + mauXau}; STOP ${duocStop}; proxy ↑ ${tk.di.khung} khung / ${tk.di.doan} đoạn (gộp ${tk.di.doanGop}, tách ${tk.di.doanTach})` +
              ` ↓ ${tk.ve.khung} khung / ${tk.ve.doan} đoạn (gộp ${tk.ve.doanGop}, tách ${tk.ve.doanTach}); không trả lời: treo>1s ${tk.treoQua1s}, mất khi đóng ${tk.matKhiDong}`,
            ms,
            thanhGhi: coilTxt(truoc, sau),
            dat: rot === 0 && mauXau === 0 && st === "acked_verified" && okR === true && truoc === false && sau === true && tk.treoQua1s === 0 && tk.matKhiDong === 0,
          });
        });
        await buoc(lap, "B1b", async () => {
        // R1b-2b-1 T17 — `--cat-lien-ket`: STOP HMI trên máy B1b khi proxy cắt liên kết ở FC5 ⇒ `timeout` (không rõ) NGAY, không ack, không 5 s
        if (proxy) {
          const kieu: KieuCat = lap % 2 === 1 ? "truoc_khi_gui" : "sau_khi_gui";
          const msNoi = await doiDen(() => ot.getActiveDriver(adapterB1)?.isConnected() === true, 15_000);
          const drvB1 = ot.getActiveDriver(adapterB1); // giữ tham chiếu: sau khi mất liên kết getActiveDriver (legacy) trả rỗng
          await ghiCoil(o.endpoint, COIL_B1, false);
          const truoc = await docCoil(o.endpoint, COIL_B1);
          proxy.lenCo(kieu);
          const t0 = Date.now();
          let duoc = "";
          let st = "";
          let okR: boolean | undefined;
          try {
            const kq = await caller.dungMay({ machineId: machineB1, clientRequestId: randomUUID() });
            const r = kq.ketQua[0];
            st = String(r?.status);
            okR = r?.ok;
            duoc = `${r?.status} ok=${r?.ok}${r?.reason ? ` ${r.reason}` : ""} · ${kq.ketQua.length} adapter`;
          } catch (e) {
            duoc = `NÉM ${maLoi(e)}`;
          }
          const ms = Date.now() - t0;
          const catLuc = proxy.daCatLuc();
          const loiB1 = drvB1 ? ((await drvB1.health()).lastError ?? "(trống — b1 đã nối lại trước khi đọc)") : "(không có driver b1 lúc bấm)";
          const sau = await docCoil(o.endpoint, COIL_B1);
          const msNoiLai = await doiDen(() => ot.getActiveDriver(adapterB1)?.isConnected() === true, 15_000);
          console.log(
            `[bench] B1b-cắt lượt ${lap} (${kieu}): b1 đã nối sau ${msNoi ?? "KHÔNG"} ms; cắt ở +${catLuc === null ? "KHÔNG CẮT" : catLuc - t0} ms; trả lời ${ms} ms;` +
              ` lastError b1 = ${loiB1}; b1 nối lại sau ${msNoiLai ?? "KHÔNG (15 s)"} ms`,
          );
          themDong({
            lap,
            o: "B1b-cắt",
            buoc: `STOP HMI máy B1b, proxy cắt liên kết ở FC5 (${kieu === "truoc_khi_gui" ? "trước khi gửi" : "sau khi gửi"})`,
            mong: `timeout ok=false (không rõ kết cục) < 1000 ms; KHÔNG acked / failed; coil ${kieu === "truoc_khi_gui" ? "0 → 0" : "0 → 1"}`,
            duoc,
            ms,
            thanhGhi: coilTxt(truoc, sau),
            dat:
              catLuc !== null &&
              st === "timeout" &&
              okR === false &&
              ms < 1000 &&
              truoc === false &&
              sau === (kieu === "sau_khi_gui"),
          });
        } else {
          // B1b — điều kiện 1c: STOP HMI trên máy B1b, ghim 1 trên coil kiểu INT ⇒ coil TRUE, acked_verified
          await ghiCoil(o.endpoint, COIL_B1, false);
          const truoc = await docCoil(o.endpoint, COIL_B1);
          const t0 = Date.now();
          let duoc = "";
          let dat = false;
          try {
            const kq = await caller.dungMay({ machineId: machineB1, clientRequestId: randomUUID() });
            const r = kq.ketQua[0];
            duoc = `${r?.status} ok=${r?.ok}${r?.reason ? ` ${r.reason}` : ""} · ${kq.ketQua.length} adapter · writes=${JSON.stringify(r?.writes ?? null)}`;
            dat =
              kq.ketQua.length === 1 &&
              r.adapterId === adapterB1 &&
              r.status === "acked_verified" &&
              r.ok === true &&
              r.simulated === false &&
              JSON.stringify(r.writes) === JSON.stringify([{ tagKey: "icoil", value: 1 }]);
          } catch (e) {
            duoc = `NÉM ${maLoi(e)}`;
          }
          const ms = Date.now() - t0;
          const sau = await docCoil(o.endpoint, COIL_B1);
          themDong({
            lap,
            o: "B1b",
            buoc: `STOP HMI máy B1b — icoil (INT, coil:${COIL_B1 + 1}) ghim STOP 1`,
            mong: "acked_verified, coil = 1 (TRUE)",
            duoc,
            ms,
            thanhGhi: coilTxt(truoc, sau),
            dat: dat && truoc === false && sau === true,
          });
        }
        });
        // trả coil về gốc của bước 0b
        await buoc(lap, "B1-trả", async () => {
        await ghiCoil(o.endpoint, COIL_B1, gocCoilB1);
        const sauTra = await docCoil(o.endpoint, COIL_B1);
        themDong({ lap, o: "B1-trả", buoc: `trả coil:${COIL_B1 + 1} về gốc`, mong: `coil = gốc ${so01(gocCoilB1)}`, duoc: `đọc ${so01(sauTra)}`, ms: 0, thanhGhi: `coil ${so01(sauTra)}`, dat: sauTra === gocCoilB1 });
        });
      }
    }
    console.log(`[bench] số hàng telemetry đi qua bus (seam ghi, không ghi DB): ${soHangTelemetry}`);
  } catch (e) {
    // R1b-2b-1 T17 (chẩn đoán) — lỗi NGOÀI các bước (thiết lập / OT không lên …) ⇒ một dòng ĐỎ có lý do + stack; dọn và bảng vẫn chạy.
    ghiLoiBuoc(0, "THIẾT LẬP", e);
  } finally {
    for (const fn of don.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.warn(`[bench] dọn: ${(e as Error).message}`);
      }
    }
    if (!o.khongDocker) {
      try {
        const s = trangThaiContainer(o.container);
        if (banDau !== "running" && banDau !== "paused" && s !== "exited") docker("stop", o.container);
        if (banDau === "paused" && s === "running") docker("pause", o.container);
        console.log(`[bench] container trả về: ${trangThaiContainer(o.container)} (ban đầu: ${banDau})`);
      } catch (e) {
        console.warn(`[bench] không trả được trạng thái container: ${(e as Error).message}`);
      }
    }
  }

  const out = ["| Lượt | Ô | Bước | Mong đợi | Đo được | ms | Thanh ghi / coil (client riêng) | Kết quả |", "|---|---|---|---|---|---|---|---|"];
  for (const d of bang) out.push(`| ${d.lap} | ${d.o} | ${d.buoc} | ${d.mong} | ${d.duoc} | ${d.ms} | ${d.thanhGhi} | ${d.dat ? "ĐẠT" : "KHÔNG ĐẠT"} |`);
  console.log(out.join("\n"));
  const dat = bang.filter((d) => d.dat).length;
  console.log(`[bench] tổng: ${dat}/${bang.length} bước ĐẠT${o.khongDocker ? " (CHẠY KHÔ — không phải OpenPLC)" : ""}`);
  console.log(`[bench] JSON ${JSON.stringify(bang)}`);
  if (dat !== bang.length) process.exitCode = 2;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error("[bench] lỗi:", e);
    process.exit(1);
  },
);
