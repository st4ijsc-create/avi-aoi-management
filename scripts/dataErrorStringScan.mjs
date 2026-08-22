/**
 * F14 — bộ đếm cho lớp nợ MỚI: **chuỗi lỗi thô đi ra như DỮ LIỆU THÀNH CÔNG**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO KHÔNG MỘT CỔNG NÀO ĐANG CÓ NHÌN THẤY LỚP NÀY
 * ══════════════════════════════════════════════════════════════════════════════════
 * Toàn bộ bộ máy i18n lỗi của dự án bám vào một giả định: **lỗi thì được NÉM**.
 *   • `appError()` + `errorFormatter` gắn `appCode` — chỉ cho thứ được ném;
 *   • `mapTrpcError` phía client — chỉ chạy trong `onError`;
 *   • `rawErrorCensus` (F3) — chỉ đếm `throw new Error(`;
 *   • `rawErrorMessageCensus` (F1) — chỉ quét `client/src`.
 *
 * Nhưng nhiều thủ tục **bắt lỗi rồi TRẢ VỀ nó như dữ liệu**:
 *     return { ok: false, latencyMs: 0, error: err.message }
 * Đó là một phản hồi THÀNH CÔNG. `onError` không chạy. `appCode` không tồn tại. Chuỗi
 * tiếng Anh của driver đi thẳng vào `res` rồi lên màn hình.
 *
 * ── BẰNG CHỨNG (đo 2026-08-22, `DeviceOnboardingWizard.tsx`) ─────────────────────
 * CÙNG MỘT Ô trên màn hình, hai đường:
 *     onError:   setTestResult({ ok: false, …, error: mapTrpcError(e) })   ← ĐÃ DỊCH
 *     onSuccess: setTestResult(res)                                        ← res.error THÔ
 * và dòng 369 render `testResult.error`. Đường HAY XẢY RA hơn (driver không nối được —
 * chuyện thường ngày ở nhà máy) chính là đường chưa dịch: người vận hành đọc
 * *"ModbusDriver: not connected"*.
 *
 * ⇒ Bài học rút ra, quan trọng hơn con số: **một bất biến chỉ đúng trong phạm vi cái
 *   nó phát biểu.** Bốn cổng đều xanh và đều thành thật; chúng chỉ chưa bao giờ nói gì
 *   về đường "lỗi đi ra bằng cửa THÀNH CÔNG".
 *
 * ⚠ KHÔNG BAO GIỜ nâng ngân sách để test xanh.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Trường mang câu cho người đọc, gán bằng `.message` của một ĐỊNH DANH LỖI.
 *
 * ⚠ Bản đầu nhận mọi định danh và đếm 258 chỗ — trong đó `input.message` (dữ liệu người
 * dùng gửi lên), `res.message` (kết quả của service), `alerts.message` (cột DB) đều KHÔNG
 * phải nợ. Siết về đúng định danh lỗi đưa số thật về 165. Thước rộng thì con số to hơn
 * nhưng vô nghĩa — và một con số vô nghĩa vẫn được người ta lập kế hoạch theo.
 */
const RE_DATA_ERROR =
  /\b(?:error|message|errorMessage|reason|detail|err)\s*:\s*(?:[\w$]*(?:err|error|e|ex)[\w$]*\s*instanceof\s*Error\s*\?\s*)?(?:[\w$]*(?:[Ee]rr|[Ee]rror)[\w$]*|e|ex)\??\.message\b/g;

export const DAU_MIEN_TRU = /data-raw-ok:\s*\S/;

export function duyetTs(goc) {
  const out = [];
  for (const ten of readdirSync(goc)) {
    const day = join(goc, ten);
    if (statSync(day).isDirectory()) out.push(...duyetTs(day));
    else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten)) out.push(day);
  }
  return out;
}

/** Bỏ comment, giữ nguyên offset — bài học F1: thước từng tố chính lời cảnh báo của nó. */
function boComment(src) {
  let out = "", i = 0, tt = "ma", dau = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (tt === "ma") {
      if (c === "/" && d === "/") { tt = "dong"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { tt = "khoi"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'") { tt = "chuoi"; dau = c; out += c; i++; continue; }
      if (c === "`") { tt = "mau"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (tt === "chuoi" || tt === "mau") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if ((tt === "chuoi" && c === dau) || (tt === "mau" && c === "`")) tt = "ma";
      out += c; i++; continue;
    }
    if (tt === "dong") { if (c === "\n") { tt = "ma"; out += c; i++; continue; } out += " "; i++; continue; }
    if (c === "*" && d === "/") { tt = "ma"; out += "  "; i += 2; continue; }
    out += c === "\n" ? c : " "; i++;
  }
  return out;
}

/** Dòng hit + toàn bộ khối comment liền kề trên nó (bài học F1: lý do dài phải xuống dòng). */
function nganhCanh(goc, idx) {
  const tatCa = goc.split("\n");
  const dong = goc.slice(0, idx).split("\n").length;
  const van = [tatCa[dong - 1] ?? ""];
  for (let i = dong - 2; i >= 0; i--) {
    const ln = (tatCa[i] ?? "").trim();
    if (!ln.startsWith("//") && !ln.startsWith("*") && !ln.startsWith("/*")) break;
    van.push(tatCa[i]);
  }
  return { dong, van: van.join("\n") };
}

/**
 * Phản hồi REST (Express) — `res.status(…).json({…})` / `res.json({…})`.
 *
 * ⚠ ĐÂY KHÔNG PHẢI NỢ, và phân biệt được nó mới là phần khó của phép đo này.
 * Khách hàng của các tuyến REST là MÁY và hệ tích hợp, không phải người vận hành: tiếng
 * Anh là quy ước đúng, và dịch nó sang tiếng Việt sẽ phá hợp đồng API với bên thứ ba.
 * Bản đầu của thước gộp cả hai và ra 164 chỗ; trong đó **~85 chỗ** ở `server/_core/index.ts`
 * + `server/routes/**` là REST. Một con số gộp hai thứ ngược nhau thì to hơn mà vô dụng —
 * người đọc sẽ lập kế hoạch sửa cả những chỗ SỬA LÀ HỎNG.
 */
const RE_REST = /\bres\s*(?:\.\s*status\s*\([^)]*\)\s*)?\.\s*json\s*\(/;

/**
 * GHI VÀO BẢNG NHẬT KÝ / KIỂM TOÁN — cũng KHÔNG phải nợ.
 *
 * ⚠ Trục thứ ba này phát hiện muộn, khi đi sửa 18 chỗ "kênh tRPC" thì thấy vài chỗ chưa
 * bao giờ rời máy chủ: `backupRouter:104` ghi `errorMessage` vào `backup_logs` rồi mới
 * ném một `appError` RIÊNG cho người dùng; `webhookRouter:142` ghi vào sổ giao vận;
 * `systemRouters:554` ghi vào nhật ký báo cáo định kỳ.
 *
 * Ở nhật ký kỹ thuật, chuỗi GỐC mới là thứ đúng: nó là bằng chứng để truy nguyên, không
 * phải câu nói với người dùng. Dịch nó đi là làm hỏng chính thứ nhật ký sinh ra để làm.
 *
 * ⇒ Bài học lặp lại (lần thứ hai trong cùng phép đo này, sau trục REST): **phân loại
 *   khó hơn đếm.** Một con số gộp các thứ có bản chất NGƯỢC nhau thì to hơn mà vô dụng —
 *   nó chỉ dẫn người ta đi sửa vào chỗ sửa là hỏng.
 */
const RE_NHAT_KY = /\b(?:db|tx|trx)\s*\.\s*(?:insert\s*\(|create[A-Za-z]*Log\s*\(|log[A-Za-z]*\s*\()/;

/** @returns {{file:string,dong:number,cau:string,kenh:"trpc"|"rest"|"log"|"service"}[]} */
export function demDataError(goc = "server") {
  const no = [];
  for (const file of duyetTs(goc)) {
    const rel = file.split("\\").join("/");
    const gocSrc = readFileSync(file, "utf8");
    const src = boComment(gocSrc);
    const dongSrc = src.split("\n");
    for (const m of src.matchAll(RE_DATA_ERROR)) {
      const { dong, van } = nganhCanh(gocSrc, m.index);
      if (DAU_MIEN_TRU.test(van)) continue;
      // Lời gọi `res.json` có thể xuống dòng ⇒ nhìn lùi tối đa 3 dòng.
      const quanh = dongSrc.slice(Math.max(0, dong - 4), dong).join("\n");
      // Khối `.values({ … })` của một INSERT thường dài hơn ⇒ cửa sổ rộng hơn. Vẫn phải
      // CÓ GIỚI HẠN: nhìn quá xa sẽ nhận nhầm một `db.insert` ở thủ tục bên cạnh, và khi
      // ấy thước tự cấp miễn trừ cho thứ nó phải canh (bài học `timeframeGuard`).
      const quanhRong = dongSrc.slice(Math.max(0, dong - 14), dong).join("\n");
      const kenh = RE_REST.test(quanh)
        ? "rest"
        : RE_NHAT_KY.test(quanhRong)
          ? "log"
          : rel.includes("/routers/")
            ? "trpc"
            : "service";
      no.push({ file: rel, dong, cau: src.slice(m.index, m.index + 90).split("\n")[0].trim(), kenh });
    }
  }
  return no;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const no = demDataError(process.argv[2] ?? "server");
  const dem = (k) => no.filter((x) => x.kenh === k).length;
  console.log(
    `TỔNG ${no.length}  ·  tRPC ${dem("trpc")} (NỢ — tới màn hình người dùng)` +
      `  ·  REST ${dem("rest")} (không phải nợ — khách là máy)  ·  service ${dem("service")} (cần truy vết)\n`,
  );
  const byF = new Map();
  for (const x of no.filter((y) => y.kenh !== "rest")) byF.set(`${x.kenh}  ${x.file}`, (byF.get(`${x.kenh}  ${x.file}`) ?? 0) + 1);
  for (const [f, n] of [...byF].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    console.log(`${String(n).padStart(3)}  ${f}`);
  }
}
