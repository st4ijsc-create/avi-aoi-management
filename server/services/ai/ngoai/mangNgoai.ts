/**
 * ★ Đợt 10.3 B1 — MẠNG RA NGOÀI DUY NHẤT của nhà cung cấp AI ngoài. Mỗi lời gọi:
 *   (1) kiểm TĨNH URL (`kiemEndpointLuu`: chỉ http(s), cấm userinfo / query / metadata / link-local, công cộng phải https, nội bộ phải
 *       khai `ai_ngoai_host_noi_bo`) — kiểm LẠI mỗi lần gọi, không tin giá trị đã lưu (rà kiem-dinh mục 11);
 *   (2) phân giải DNS MỘT lần + ghim IP (`kiemDichDen` — địa chỉ nội bộ chỉ khi khai host:cổng) ⇒ đổi DNS giữa hai lần gọi bị bắt lại;
 *   (3) `fetchGhim`: `http(s).request` kết nối đúng IP đã ghim, KHÔNG theo chuyển hướng, KHÔNG dùng proxy env (`HTTP(S)_PROXY` bị bỏ
 *       qua vì không qua `fetch` toàn cục), TLS mặc định của Node (CA hệ thống, kiểm tên) — CẤM tắt kiểm chứng chỉ (lưới grep canh);
 *   (4) thân phản hồi ≤ 4 MB đọc dạng luồng, hạn 120 s.
 * Lỗi trước khi kết nối được (URL, DNS, TLS, từ chối kết nối) ⇒ `chuaGui` (cổng hoàn chỗ); lỗi sau đó ⇒ `thuLai` (cổng thử lại).
 */
import { fetchGhim, kiemDichDen, docThanCoTran } from "../../flow/nut/mangAnToan";
import { docRetryAfter } from "./nhaCungCap/chung";
import { LoiNgoai } from "./loi";
import type { MangNgoai } from "./nhaCungCap/kieu";
import { kiemEndpointLuu, laLinkLocalHoacMetadata } from "./urlNgoai";

export const TRAN_THAN_PHAN_HOI = 4 * 1024 * 1024;
export const HAN_GOI_MS = 120_000;

const LOI_CHUA_KET_NOI = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

/** Lưới: thay phần GỬI (sau mọi kiểm URL / DNS) bằng máy chủ giả trong tiến trình. */
let fetchChoTest: ((url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ status: number; json: unknown; retryAfterMs?: number }>) | null = null;
export function datFetchNgoaiChoTest(f: typeof fetchChoTest): void {
  fetchChoTest = f;
}

export function taoMangNgoai(chinhSach: { hostNoiBo: ReadonlySet<string> }): MangNgoai {
  return {
    async goiJson(url, init) {
      let u: URL;
      try {
        u = new URL(kiemEndpointLuu(url, chinhSach.hostNoiBo));
      } catch (e) {
        throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", (e as LoiNgoai).chiTiet ?? "url", { chuaGui: true });
      }
      let dich;
      try {
        dich = await kiemDichDen(u, chinhSach.hostNoiBo);
      } catch (e) {
        throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", (e as { ma?: string }).ma ?? "dns", { chuaGui: true });
      }
      // Rà kiem-dinh Task 8 E — host ĐÃ KHAI nội bộ nhưng PHÂN GIẢI ra link-local / metadata ⇒ vẫn cấm (danh sách trắng chỉ mở dải nội bộ thường).
      if (laLinkLocalHoacMetadata(dich.ip)) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "metadata-sau-dns", { chuaGui: true });
      if (fetchChoTest) return fetchChoTest(u.toString(), init);
      let r: Response;
      try {
        r = await fetchGhim(u, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(HAN_GOI_MS) }, dich);
      } catch (e) {
        const code = String((e as { code?: unknown }).code ?? "");
        if (LOI_CHUA_KET_NOI.has(code)) throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `ket-noi: ${code}`, { chuaGui: true, phanLoai: "TRANSPORT" });
        // (H3.1) hết hạn `HAN_GOI_MS` (AbortSignal.timeout ⇒ TimeoutError) tách khỏi đứt kết nối — cả hai thử lại được
        const hetGio = (e as { name?: unknown })?.name === "TimeoutError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT";
        throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `mang: ${hetGio ? "het-gio" : code || "loi"}`, { thuLai: true, phanLoai: hetGio ? "TIMEOUT" : "TRANSPORT" });
      }
      if (r.status >= 300 && r.status < 400) {
        await r.body?.cancel().catch(() => undefined);
        throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `chuyen-huong ${r.status} (không theo)`);
      }
      let than: string;
      try {
        than = await docThanCoTran(r, TRAN_THAN_PHAN_HOI);
      } catch {
        throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "phan-hoi-qua-lon");
      }
      let json: unknown = null;
      try {
        json = than ? JSON.parse(than) : null;
      } catch {
        json = { raw: than.slice(0, 500) };
      }
      const cho = r.status === 429 || r.status === 503 ? docRetryAfter(r.headers.get("retry-after")) : undefined;
      return { status: r.status, json, ...(cho !== undefined ? { retryAfterMs: cho } : {}) };
    },
  };
}
