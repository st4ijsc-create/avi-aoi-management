/**
 * Cấp khoá riêng `mk_` cho từng máy (nhóm C mục #2, chủ dự án duyệt 2026-08-21).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CẦN — đo từ CSDL ngày 2026-08-21
 * ══════════════════════════════════════════════════════════════════════════════
 * 42 máy, **0 máy có khoá `mk_`**. 16 máy kiểm tra dùng `machines.apiKey` DẠNG CHỮ
 * THƯỜNG; 26 máy tự động/IoT KHÔNG có bí mật nào — chỉ cần biết mã máy (mã in trên
 * nhãn thiết bị) là ghi được dữ liệu nhân danh máy đó.
 *
 * ⇒ Đây là ĐIỀU KIỆN TRƯỚC của việc siết `MACHINE_CODE_ONLY_ALLOWED=deny`. Siết mà
 *   chưa cấp khoá thì khoá sạch cả 42 máy lúc chúng quay lại.
 *
 * ⚠ KHOÁ HIỆN MỘT LẦN DUY NHẤT. CSDL chỉ lưu SHA-256; không ai lấy lại được bản rõ.
 *   Chép ra chỗ an toàn NGAY, rồi nạp vào từng máy theo cột `machineCode`.
 *
 * Dùng:
 *   npx tsx scripts/issue-machine-keys.ts --dry-run     # xem sẽ cấp cho máy nào
 *   npx tsx scripts/issue-machine-keys.ts --confirm     # cấp thật, in bảng khoá
 *   npx tsx scripts/issue-machine-keys.ts --confirm --out keys.csv
 *
 * Bỏ qua máy ĐÃ có khoá `mk_` còn hiệu lực ⇒ chạy lại nhiều lần vẫn an toàn
 * (idempotent), không đẻ khoá trùng.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import { apiKeys, machines } from "../drizzle/schema";
import { issueMachineKey } from "../server/services/machineAuthService";

const args = process.argv.slice(2);
const CHAY_THAT = args.includes("--confirm");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;

async function main() {
  const d = await getDb();

  const dsMay = await d
    .select({
      id: machines.id,
      code: machines.code,
      name: machines.name,
      type: machines.machineType,
      lifecycle: machines.lifecycleStatus,
      registration: machines.registrationStatus,
    })
    .from(machines);

  // Máy đã có khoá mk_ ACTIVE, chưa thu hồi, chưa hết hạn → BỎ QUA.
  const khoaDangSong = await d
    .select({ machineId: apiKeys.machineId })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.isActive, true),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    );
  const daCo = new Set(khoaDangSong.map((k) => k.machineId).filter((x): x is number => x != null));

  /**
   * ⚠ BỎ máy đã ngừng dùng — lượt chạy đầu (2026-08-21) KHÔNG kiểm điều này và đã cấp
   * khoá cho `SN-ST4I-TRIAL-WELD-20260818` (`lifecycleStatus=retired`,
   * `registrationStatus=rejected`). Chính báo cáo của runbook doc 52 tố ra:
   * *"Máy đã retired nhưng CÒN credential"*. Khoá đó đã bị thu hồi.
   *
   * Cấp khoá cho máy đã retired là tạo một credential sống cho thiết bị KHÔNG CÒN
   * được giám sát — đúng thứ đợt siết này sinh ra để loại bỏ.
   */
  const NGUNG_DUNG = new Set(["retired", "decommissioned", "disposed"]);
  const boQuaVongDoi = dsMay.filter(
    (m) => NGUNG_DUNG.has(String(m.lifecycle ?? "")) || String(m.registration ?? "") === "rejected",
  );
  if (boQuaVongDoi.length) {
    console.log(`Bỏ qua ${boQuaVongDoi.length} máy đã ngừng dùng / bị từ chối:`);
    for (const m of boQuaVongDoi) console.log(`   - ${m.code} (${m.lifecycle}/${m.registration})`);
    console.log("");
  }

  /**
   * ★★★ 2026-09-18 — BỎ QUA CẢ MÁY **CHƯA ĐƯỢC DUYỆT** (`registrationStatus != 'approved'`).
   *
   * Đây là số đo, không phải lo xa. Script này viết 2026-08-21 khi CSDL có **42 máy** và
   * (gần như) tất cả đã duyệt, nên diện bỏ qua chỉ cần `retired/decommissioned/disposed`
   * + `rejected`. Đo lại 2026-09-18: **1.700 máy, trong đó 550 `pending`**, và `--dry-run`
   * khai sẽ cấp **1.657** khoá — tức **549 khoá sống cho máy FUYU-F mà chưa ai duyệt**.
   *
   * Cấp khoá cho máy `pending` là **đúng cùng một lớp lỗi** mà đoạn trên sinh ra để chặn,
   * chỉ khác trạng thái: một credential sống cho thiết bị **chưa qua cửa duyệt**. Và nó
   * còn lật ngược thứ tự của chính sản phẩm — `machine.approve` (`hierarchyRouters.ts:1035`)
   * là nơi DUY NHẤT vừa lật `registrationStatus` vừa phát giấy tờ, trong MỘT thao tác của
   * người quản trị. Cấp trước rồi duyệt sau làm cửa duyệt mất nghĩa.
   *
   * ⚠ Bỏ qua ở đây KHÔNG phải "bỏ rơi": máy `pending` có đường đi riêng và đúng — duyệt nó
   *   qua `machine.approve`, và chính lượt duyệt ấy sẽ phát khoá. Script này chỉ để **vá
   *   khoảng trống** cho máy ĐÃ duyệt mà thiếu giấy tờ (đo được 2026-09-18: **1.108 máy
   *   QATD-A/B/C `approved` mà không có `machines.apiKey`, không `mk_`, không claim token**).
   *
   * ★ Đường duyệt KHÔNG hỏng — đã chạy thật một máy để biết, không đọc mã rồi suy:
   *   `machine.approve` trên `FUYU-F-T1-L1-M1` (`pending`) ⇒ HTTP 200, cờ lật `approved`,
   *   sinh `machines.apiKey = mach_…` **và** một claim token `mct_…` (đã hoàn nguyên sạch).
   *   Nên 1.108 máy kia là do được tạo **đi tắt** — không script nào dưới `scripts/` sinh ra
   *   chúng (đã grep toàn repo), chúng đến từ bộ QA của một phiên khác. **Không quy cho một
   *   tệp cụ thể ở đây**: chưa đo được thì không ghi tên.
   *
   * ⚠⚠ CẢ HAI nhánh phát giấy tờ trong `machine.approve` đều bọc `try/catch` và chỉ
   *   `logger.warn` (mã tự khai *"best-effort BY DESIGN — a credential failure must not 500
   *   the admin"*). Nghĩa là **`approved` không hứa là CÓ giấy tờ**, và không có gì đối soát
   *   lại về sau. Script này chính là cái đối soát ấy — chạy `--dry-run` định kỳ, con số
   *   `CẦN CẤP` > 0 là một cảnh báo, không phải việc vặt.
   */
  const chuaDuyet = dsMay.filter(
    (m) => !boQuaVongDoi.includes(m) && String(m.registration ?? "") !== "approved",
  );
  if (chuaDuyet.length) {
    console.log(`Bỏ qua ${chuaDuyet.length} máy CHƯA ĐƯỢC DUYỆT (registrationStatus != 'approved'):`);
    for (const m of chuaDuyet.slice(0, 10)) console.log(`   - ${m.code} (${m.registration})`);
    if (chuaDuyet.length > 10) console.log(`   … và ${chuaDuyet.length - 10} máy nữa`);
    console.log("   ⇒ Duyệt chúng qua `machine.approve`; chính lượt duyệt đó phát giấy tờ.\n");
  }

  const boQuaIds = new Set([...boQuaVongDoi, ...chuaDuyet].map((m) => m.id));

  const canCap = dsMay.filter((m) => !daCo.has(m.id) && !boQuaIds.has(m.id));

  console.log(`Tổng máy: ${dsMay.length} · đã có khoá mk_ còn hiệu lực: ${daCo.size} · CẦN CẤP: ${canCap.length}\n`);
  if (canCap.length === 0) { console.log("Không có gì để làm."); return; }

  if (!CHAY_THAT) {
    console.log("── THỬ (chưa ghi gì) ──");
    for (const m of canCap) console.log(`  ${String(m.id).padStart(4)}  ${m.code.padEnd(18)} ${m.type}  ${m.name ?? ""}`);
    console.log(`\nChạy lại với --confirm để cấp thật ${canCap.length} khoá.`);
    return;
  }

  const ketQua: Array<{ machineId: number; machineCode: string; machineType: string; key: string }> = [];
  for (const m of canCap) {
    const r = await issueMachineKey({ machineId: m.id, name: `machine:${m.code}` });
    ketQua.push({ machineId: m.id, machineCode: m.code, machineType: String(m.type), key: r.plaintextKey });
    console.log(`  ✓ ${m.code.padEnd(18)} ${r.plaintextKey}`);
  }

  console.log(`\nĐã cấp ${ketQua.length} khoá. ⚠ Bản rõ CHỈ hiện lần này — CSDL chỉ giữ SHA-256.`);

  if (OUT) {
    const csv = ["machineId,machineCode,machineType,key", ...ketQua.map((r) => `${r.machineId},${r.machineCode},${r.machineType},${r.key}`)].join("\n");
    writeFileSync(OUT, csv + "\n", "utf8");
    console.log(`→ ghi ${OUT} (CHỨA BÍ MẬT — đừng commit, xoá sau khi nạp xong)`);
  }

  console.log(
    `\nBƯỚC TIẾP: nạp từng khoá vào máy theo machineCode, gửi kèm header\n` +
      `  Authorization: Bearer mk_...   (hoặc X-API-Key: mk_...)\n` +
      `Khi 42/42 máy đã nạp xong mới đặt MACHINE_CODE_ONLY_ALLOWED=deny.`,
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
