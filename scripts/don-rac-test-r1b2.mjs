#!/usr/bin/env node
/**
 * R1b-2a T14 — dọn rác của R1b-1 T2 / R1b-2a T5 ở CSDL `aoi_management_test`, bằng vai owner.
 *
 *   npx tsx scripts/don-rac-test-r1b2.mjs --test-only          CHẠY KHÔ (mặc định): TÌM mục tiêu bằng truy vấn mã test, in MỘT khối JSON `MUC_TIEU tìm được:` + dòng
 *                                                              `--ids=...`, chạy ĐÚNG các lệnh xoá trong MỘT giao dịch rồi HOÀN TÁC, in bảng "sẽ xoá".
 *   npx tsx scripts/don-rac-test-r1b2.mjs --test-only --ghi --ids=<đúng chuỗi chạy khô đã in>
 *                                                              xoá thật: MỘT giao dịch, tìm lại; KHÁC `--ids` dù một id ⇒ từ chối, không xoá gì;
 *                                                              đếm lại ⇒ 0 mới COMMIT; lỗi bất kỳ ⇒ hoàn tác toàn bộ.
 *
 * ĐỊNH DẠNG --ids (không ký tự đặc biệt của shell): `nhom:id.id.id,nhom:id.id` — nhóm ∈ adapters, edgeNodes, machines, stations, lines,
 *   workshops, factories; id tăng dần; không có gì ⇒ `-`. Ví dụ: `--ids=adapters:26336.26342,machines:38939.38940`.
 * KHÔNG chạy song song với lưới test: fixture `pvk` / `tth` / `r1b2` đang sống của lưới khác khớp mẫu và sẽ bị liệt kê (rồi bị xoá nếu --ghi).
 *
 * AN TOÀN (phán quyết K14, điều phối 2026-10-25):
 *   - PHẢI có `--test-only`; không cờ nào chọn DEV (`--dev-only`, `--apply`, … ⇒ thoát 2, không mở kết nối).
 *   - Hai lớp chốt: (1) tên CSDL trong URL owner PHẢI kết thúc `_test` (`laDbTest`) — kiểm TRƯỚC khi mở kết nối;
 *     (2) `current_database()` trên CHÍNH kết nối ghi (qua `asOwner`, kể cả khi MIGRATION_DB_URL đè URL) PHẢI kết thúc `_test`,
 *     kiểm lại TRONG giao dịch. Sai ⇒ thoát 2, không câu lệnh nào khác.
 *   - Đích được TÌM bằng truy vấn `code ~* MAU_MA_TEST_SQL` (không id viết tay), nhưng KHÔNG xoá mù theo tiền tố — tiền tố đó trùng dữ liệu
 *     test đang sống của lượt chạy khác. Nên: chạy khô liệt kê; `--ghi` BẮT BUỘC kèm `--ids` chép đúng từ chạy khô; trong giao dịch xoá,
 *     script tìm lại và so với `--ids`: lệch bất kỳ ⇒ từ chối, xoá 0. Thiếu `--ids` với `--ghi` ⇒ từ chối (thoát 2, không mở kết nối).
 *   - Adapter tìm được mà `machineId` trỏ máy KHÔNG nằm trong tập tìm được ⇒ từ chối (`kiemMoCoi`; không xoá adapter gắn máy thật).
 *     Mỗi id phải mang mã khớp mẫu test (`kiemTenMa`).
 *   - KHÔNG xoá hàng WORM: scada_command_attempts, command_log, các bảng audit — để nguyên và in rõ.
 *   - STOP chưa ack ⇒ từ chối (không thể tự ack); STOP bị refused/failed chưa giải quyết ⇒ `edge_stop_resolve` bằng admin id nhỏ nhất.
 * Exit: 0 xong (kể cả chạy khô); 1 lỗi (đã hoàn tác); 2 từ chối.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import postgres from "postgres";
import { asOwner, testDbUrl } from "./apply-migration-dot10-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Mẫu cố định CHO TEST (khảo sát chỉ-đọc 2026-10-26) — chạy thật không còn dùng; đích do `timMucTieu` tìm. Truyền qua `o.muc`. */
export const MUC_TIEU = {
  // R1b-1 §6 mục 28: 26336 / 26342 / 26343 còn; 26337 đã mất; 27035 là adapter r1b2 thứ tư (lượt chạy thứ ba, cùng loại rác)
  adapters: [26336, 26342, 26343, 27035],
  edgeNodes: [54443, 54444, 54618],
  // 38939–38948 + 39284–39288 = các máy r1b2 (r/l/e/n/x × 3 lượt); 56136–56139, 56182–56185 = pvk (T5); 56440 = tth (T5)
  machines: [...range(38939, 38948), ...range(39284, 39288), ...range(56136, 56139), ...range(56182, 56185), 56440],
  stations: [...range(25177, 25180), 25379, 25380, 37638, 37639, 37668, 37669, 37786],
  lines: [...range(26697, 26700), 26899, 26900, 39572, 39573, 39603, 39604, 39728],
  workshops: [...range(26412, 26415), 26605, 26606, 39306, 39307, 39339, 39340, 39465],
  factories: [...range(30757, 30760), 30959, 30960, 45079, 45080, 45115, 45116, 45261],
};

/** Một nguồn: chuỗi cho SQL `~*`, RegExp dựng từ chính nó. */
export const MAU_MA_TEST_SQL = "^(r1b2|pvk|tth)";
export const MAU_MA_TEST = new RegExp(MAU_MA_TEST_SQL, "i");

export class TuChoi extends Error {}
const HOAN_TAC = new Error("chay-kho-hoan-tac");

/** Tên CSDL (cuối pathname của URL) có kết thúc `_test` không. Sai kiểu / rỗng ⇒ false. */
export function laDbTest(url) {
  try {
    return /_test$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
/** `host:port` của một URL (cổng mặc định 5432); không phân tích được ⇒ null. */
export function hostPort(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.port || "5432"}`;
  } catch {
    return null;
  }
}
/** Cùng luật cho kết quả `current_database()`. */
export function tenDbLaTest(ten) {
  return typeof ten === "string" && /_test$/.test(ten);
}

function napEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const dong of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = dong.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const BANG_MA = [
  ["device_adapters", "adapters"],
  ["edge_nodes", "edgeNodes"],
  ["machines", "machines"],
  ["stations", "stations"],
  ["production_lines", "lines"],
  ["workshops", "workshops"],
  ["factories", "factories"],
];

const NHOM = BANG_MA.map(([, k]) => k);

/** Tìm mục tiêu: với mỗi bảng `SELECT id WHERE code ~* mẫu ORDER BY id`. */
export async function timMucTieu(tx, mauMaSql = MAU_MA_TEST_SQL) {
  const muc = {};
  for (const [bang, khoa] of BANG_MA) {
    const rows = await tx`SELECT id FROM ${tx(bang)} WHERE code ~* ${mauMaSql} ORDER BY id`;
    muc[khoa] = rows.map((r) => Number(r.id));
  }
  return muc;
}

/** Adapter tìm được mà machineId không NULL và không thuộc muc.machines ⇒ TuChoi (không xoá adapter gắn máy thật). */
export function kiemMoCoi(muc, hangAdapter) {
  const may = new Set(muc.machines ?? []);
  for (const a of hangAdapter) {
    if (a.machineId != null && !may.has(Number(a.machineId))) {
      throw new TuChoi(`device_adapters id ${a.id} gan may ${a.machineId} KHONG nam trong tap tim duoc — tu choi (khong xoa adapter gan may that).`);
    }
  }
}

/** Chuẩn hoá: đủ nhóm, id số duy nhất tăng dần. */
function chuanHoa(muc) {
  const out = {};
  for (const k of NHOM) out[k] = [...new Set((muc?.[k] ?? []).map(Number))].sort((a, b) => a - b);
  return out;
}
/** `nhom:id.id,nhom:id` hoặc `-`. */
export function inIds(muc) {
  const m = chuanHoa(muc);
  const p = NHOM.filter((k) => m[k].length).map((k) => `${k}:${m[k].join(".")}`);
  return p.length ? p.join(",") : "-";
}
export function docIds(chuoi) {
  const out = chuanHoa({});
  if (chuoi === "-" || chuoi === "") return out;
  for (const phan of chuoi.split(",")) {
    const m = /^([A-Za-z]+):(\d+(?:\.\d+)*)$/.exec(phan);
    if (!m || !NHOM.includes(m[1]) || out[m[1]].length) throw new TuChoi(`--ids sai dinh dang o "${phan}" — chep dung dong "--ids=..." cua lan chay kho.`);
    out[m[1]] = m[2].split(".").map(Number);
  }
  return chuanHoa(out);
}

/** Mọi id còn tồn tại phải mang mã khớp mẫu test. */
async function kiemTenMa(tx, muc, mauMa) {
  for (const [bang, khoa] of BANG_MA) {
    const ids = muc[khoa] ?? [];
    if (!ids.length) continue;
    const rows = await tx`SELECT id, code FROM ${tx(bang)} WHERE id IN ${tx(ids)}`;
    for (const r of rows) {
      if (!mauMa.test(String(r.code ?? ""))) throw new TuChoi(`${bang} id ${r.id} mang ma "${r.code}" khong khop mau test ${mauMa} — tu choi (khong xoa gi).`);
    }
  }
}

/** Chạy các bước xoá theo thứ tự FK. Trả về [{ bang, so, ghiChu }]. */
async function cacBuocXoa(tx, muc) {
  const out = [];
  const them = (bang, so, ghiChu = "", phu = false) => out.push({ bang, so: Number(so), ghiChu, phu });
  const A = muc.adapters ?? [];
  const N = muc.edgeNodes ?? [];

  // 1. STOP: chưa ack ⇒ từ chối; refused/failed chưa giải quyết ⇒ giải quyết bằng admin (hàm có bảo vệ của 0377)
  if (A.length || N.length) {
    const dich = (q) => tx`(${A.length ? tx`q."adapterId" IN ${tx(A)}` : tx`false`} OR ${N.length ? tx`q."edgeNodeId" IN ${tx(N)}` : tx`false`})`;
    const chuaAck = await tx`SELECT q.id FROM robot_motion_lock_requests q WHERE q.kind = 'stop' AND q."carriedToId" IS NULL AND q."ackedAt" IS NULL AND ${dich()}`;
    if (chuaAck.length) throw new TuChoi(`STOP chua ack (id ${chuaAck.map((r) => r.id).join(", ")}) — khong the tu ack; ack truoc roi chay lai.`);
    const treo = await tx`SELECT q.id FROM robot_motion_lock_requests q WHERE q.kind = 'stop' AND q."carriedToId" IS NULL AND q.outcome IN ('refused', 'failed') AND q."resolvedAt" IS NULL AND ${dich()} ORDER BY q.id`;
    if (treo.length) {
      const [ad] = await tx`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
      if (!ad) throw new TuChoi("khong co admin dang hoat dong de giai quyet STOP refused/failed.");
      for (const r of treo) await tx`SELECT public.edge_stop_resolve(${r.id}, ${ad.id}, 'R1b-2a T14 don _test')`;
      them("robot_motion_lock_requests (giải quyết STOP)", treo.length, `edge_stop_resolve bởi admin ${ad.id} (UPDATE, không tính vào tổng xoá)`, true);
    }
    // Xoá TẤT CẢ hàng yêu cầu (mọi kind) của adapter / node đích — không chỉ STOP; STOP đã qua hai cửa trên (đã ack, đã giải quyết).
    const r1 = await tx`DELETE FROM robot_motion_lock_requests q WHERE ${dich()}`;
    them("robot_motion_lock_requests", r1.count, "mọi hàng yêu cầu của adapter/node đích (STOP đã ack + đã giải quyết)");
  }
  if (A.length) {
    them("scada_kenh_che_do", (await tx`DELETE FROM scada_kenh_che_do WHERE adapter_id IN ${tx(A)}`).count, "cascade 0433, xoá tường minh");
    them("scada_khoa_chon", (await tx`DELETE FROM scada_khoa_chon WHERE adapter_id IN ${tx(A)}`).count, "cascade 0433, xoá tường minh");
    them("edge_node_program_reports", (await tx`DELETE FROM edge_node_program_reports WHERE "adapterId" IN ${tx(A)}`).count);
    them("device_tags", (await tx`DELETE FROM device_tags WHERE "adapterId" IN ${tx(A)}`).count);
    them("device_adapters", (await tx`DELETE FROM device_adapters WHERE id IN ${tx(A)}`).count);
  }
  if (N.length) {
    them("edge_node_program_reports", (await tx`DELETE FROM edge_node_program_reports WHERE "edgeNodeId" IN ${tx(N)}`).count, "theo node");
    them("edge_node_report_cursors", (await tx`DELETE FROM edge_node_report_cursors WHERE "edgeNodeId" IN ${tx(N)}`).count);
    them("edge_node_credentials", (await tx`DELETE FROM edge_node_credentials WHERE "edgeNodeId" IN ${tx(N)}`).count);
    them("edge_robot_trust_approvals", (await tx`DELETE FROM edge_robot_trust_approvals WHERE "edgeNodeId" IN ${tx(N)}`).count);
    them("edge_nodes", (await tx`DELETE FROM edge_nodes WHERE id IN ${tx(N)}`).count);
  }
  const buoc = [
    ["machines", "machines"],
    ["stations", "stations"],
    ["production_lines", "lines"],
    ["workshops", "workshops"],
    ["factories", "factories"],
  ];
  for (const [bang, khoa] of buoc) {
    const ids = muc[khoa] ?? [];
    if (ids.length) them(bang, (await tx`DELETE FROM ${tx(bang)} WHERE id IN ${tx(ids)}`).count);
  }
  return out;
}

/** Số hàng đích còn lại (sau xoá phải là 0). */
async function conLai(tx, muc) {
  let n = 0;
  for (const [bang, khoa] of BANG_MA) {
    const ids = muc[khoa] ?? [];
    if (!ids.length) continue;
    n += Number((await tx`SELECT count(*)::int AS n FROM ${tx(bang)} WHERE id IN ${tx(ids)}`)[0].n);
  }
  return n;
}

function inBang(log, tieuDe, buoc) {
  const rong = (s, w) => String(s).padEnd(w);
  const w = Math.max(...buoc.map((b) => b.bang.length), 5);
  log(tieuDe);
  log(`  ${rong("bang", w)}  ${rong("so hang", 8)}  ghi chu`);
  for (const b of buoc) log(`  ${rong(b.bang, w)}  ${rong(b.so, 8)}  ${b.ghiChu}`);
  log(`  ${rong("TONG", w)}  ${rong(buoc.filter((b) => !b.phu).reduce((s, b) => s + b.so, 0), 8)}`);
}

/**
 * Điểm vào kiểm thử được. `connect(url)` là seam (mặc định postgres.js). Trả về mã thoát; không gọi process.exit.
 * `o.muc` (tập cố định, cho test) bỏ qua bước tìm; `o.mauMaSql` đổi mẫu tìm (DB test dùng tiền tố RIÊNG, không đụng fixture của test khác).
 * @param {{ argv?: string[], connect?: (url: string) => any, muc?: typeof MUC_TIEU, mauMaSql?: string, mauMa?: RegExp, log?: (m: string) => void, err?: (m: string) => void }} o
 */
export async function chay(o = {}) {
  const argv = o.argv ?? process.argv.slice(2);
  const log = o.log ?? ((m) => console.log(m));
  const err = o.err ?? ((m) => console.error(m));
  const connect = o.connect ?? ((url) => postgres(url, { max: 1, onnotice: () => {} }));
  const mauMaSql = o.mauMaSql ?? MAU_MA_TEST_SQL;
  const mauMa = o.mauMa ?? new RegExp(mauMaSql, "i");
  const TAG = "[don-rac r1b2]";

  const la = argv.filter((a) => a.startsWith("--"));
  const idsArg = la.filter((a) => a.startsWith("--ids="));
  const la_la = la.filter((a) => a !== "--test-only" && a !== "--ghi" && !a.startsWith("--ids="));
  if (!la.includes("--test-only") || la_la.length || idsArg.length > 1 || argv.some((a) => !a.startsWith("--"))) {
    err(`${TAG} chi chap nhan --test-only [--ghi --ids=...]; nhan: ${argv.join(" ") || "khong co"}. Khong co co chon DEV. Khong chay gi.`);
    return 2;
  }
  const GHI = la.includes("--ghi");
  if (GHI && !idsArg.length) {
    err(`${TAG} --ghi BAT BUOC kem --ids=<chuoi in ra boi lan chay kho> — tu choi, khong mo ket noi.`);
    return 2;
  }
  let idsDuyet = null;
  if (idsArg.length) {
    try {
      idsDuyet = docIds(idsArg[0].slice("--ids=".length));
    } catch (e) {
      err(`${TAG} ${e.message}`);
      return 2;
    }
  }

  let urlOwner;
  try {
    urlOwner = asOwner(testDbUrl());
  } catch (e) {
    err(`${TAG} ${e.message} — tu choi.`);
    return 2;
  }
  // Lớp 1: URL của KẾT NỐI GHI (asOwner có thể bị MIGRATION_DB_URL đè) — trước khi mở kết nối
  if (!laDbTest(urlOwner)) {
    err(`${TAG} URL owner tro vao CSDL "${new URL(urlOwner).pathname.replace(/^\//, "")}" khong ket thuc _test — tu choi, khong mo ket noi.`);
    return 2;
  }

  // Ghim máy chủ: host:port của URL ghi PHẢI bằng host:port của DATABASE_URL (.env) — CSDL cục bộ. Một MIGRATION_DB_URL trỏ máy khác
  // có tên `*_test` sẽ qua cả hai lớp tên; chốt này chặn trước khi mở kết nối.
  const hostChuan = hostPort(process.env.DATABASE_URL);
  if (!hostChuan || hostPort(urlOwner) !== hostChuan) {
    err(`${TAG} may chu cua URL owner (${hostPort(urlOwner)}) khac may chu DATABASE_URL (${hostChuan ?? "chua dat"}) — tu choi, khong mo ket noi.`);
    return 2;
  }

  const sql = connect(urlOwner);
  let ketQua = null;
  try {
    // Lớp 2: tên CSDL THẬT trên chính kết nối ghi, kiểm lại trong giao dịch
    await sql
      .begin(async (tx) => {
        const [cdb] = await tx`SELECT current_database() AS d`;
        if (!tenDbLaTest(cdb?.d)) throw new TuChoi(`current_database()="${cdb?.d}" khong ket thuc _test — tu choi, khong cau lenh nao khac.`);
        log(`${TAG} current_database()=${cdb.d} · che do: ${GHI ? "GHI THAT" : "CHAY KHO (hoan tac)"}`);
        await tx`SET LOCAL lock_timeout = '5s'`;
        await tx`SET LOCAL statement_timeout = '60s'`;
        const muc = o.muc ? chuanHoa(o.muc) : await timMucTieu(tx, mauMaSql);
        log(`${TAG} MUC_TIEU tìm được:\n${JSON.stringify(muc, null, 2)}\n${TAG} --ids=${inIds(muc)}`);
        if (GHI && inIds(muc) !== inIds(idsDuyet)) {
          throw new TuChoi(`tap tim lai trong giao dich (--ids=${inIds(muc)}) KHAC --ids da duyet (--ids=${inIds(idsDuyet)}) — tu choi, xoa 0.`);
        }
        await kiemTenMa(tx, muc, mauMa);
        kiemMoCoi(muc, muc.adapters.length ? await tx`SELECT id, "machineId" FROM device_adapters WHERE id IN ${tx(muc.adapters)}` : []);
        const buoc = await cacBuocXoa(tx, muc);
        const [w] = (muc.adapters ?? []).length
          ? await tx`SELECT (SELECT count(*)::int FROM scada_command_attempts WHERE adapter_id IN ${tx(muc.adapters)}) AS dich,
                            (SELECT count(*)::int FROM scada_command_attempts) AS tong,
                            (SELECT count(*)::int FROM command_log WHERE "adapterId" IN ${tx(muc.adapters)}) AS cl`
          : [{ dich: 0, tong: 0, cl: 0 }];
        ketQua = { buoc, worm: w };
        if (GHI) {
          const du = await conLai(tx, muc);
          if (du !== 0) throw new Error(`sau xoa con ${du} hang dich — hoan tac.`);
        } else {
          throw HOAN_TAC;
        }
      })
      .catch((e) => {
        if (e !== HOAN_TAC) throw e;
      });
  } catch (e) {
    try {
      await sql.end?.({ timeout: 2 });
    } catch {
      /* đóng kết nối là cố gắng tối đa */
    }
    if (e instanceof TuChoi) {
      err(`${TAG} ${e.message}`);
      return 2;
    }
    err(`${TAG} LOI (da hoan tac, khong ghi gi): ${e?.message ?? e}`);
    return 1;
  }
  await sql.end?.({ timeout: 2 });
  inBang(log, GHI ? `${TAG} DA XOA:` : `${TAG} SE XOA (chay kho, da hoan tac, khong ghi gi):`, ketQua.buoc);
  log(
    `${TAG} GIU NGUYEN (WORM, khong the xoa): scada_command_attempts ${ketQua.worm.tong} hang (${ketQua.worm.dich} hang thuoc adapter dich); ` +
      `command_log ${ketQua.worm.cl} hang thuoc adapter dich; cac bang audit khac.`,
  );
  log(`${TAG} so hang xoa: ${ketQua.buoc.filter((b) => !b.phu).reduce((s, b) => s + b.so, 0)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  napEnv(path.join(__dirname, "..", ".env"));
  process.exit(await chay());
}
