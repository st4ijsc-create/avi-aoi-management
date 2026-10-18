/**
 * ★★★ ĐỢT 4B (kế hoạch 4.7, khảo sát VSCode §3.5 / P1-5) — CHẶN DẤU CHE MỚI ĐI VÀO TỆP.
 *
 * Máy chủ che bí mật/PII trước khi đưa cho model (`[REDACTED_EMAIL]`, `[REDACTED_SECRET]`…), và chính extension che
 * nội dung đọc được bằng `«đã che»` (`loi/nguCanh.ts#CHE`). Model chỉ THẤY bản đã che ⇒ khi nó viết lại đoạn đó,
 * dấu che có thể bị ghi ĐÈ lên giá trị thật trong tệp — ghi rác lên mã thật mà diff nhìn qua rất dễ bỏ sót.
 *
 * Luật (thuần, so số lần): một dấu che xuất hiện trong bản MỚI NHIỀU lần hơn trong bản GỐC ⇒ từ chối. Dấu che vốn đã
 * có trong tệp (ví dụ tài liệu mô tả chính cơ chế che) KHÔNG chặn — chỉ chặn dấu MỚI.
 */
import { CHE } from "./nguCanh";

const MAU_DAU_CHE = /\[REDACTED_[A-Za-z0-9_]*\]?/g;

function demDauChe(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of s.match(MAU_DAU_CHE) ?? []) m.set(k, (m.get(k) ?? 0) + 1);
  const soChe = s.split(CHE).length - 1;
  if (soChe > 0) m.set(CHE, soChe);
  return m;
}

/** Các dấu che xuất hiện NHIỀU HƠN trong `moi` so với `goc` (rỗng ⇒ an toàn). */
export function dauCheMoi(goc: string, moi: string): string[] {
  const a = demDauChe(goc);
  const ra: string[] = [];
  for (const [k, n] of demDauChe(moi)) if (n > (a.get(k) ?? 0)) ra.push(k);
  return ra;
}

export function lyDoDauCheMoi(dau: string[], duongTuongDoi: string): string {
  return (
    `"${duongTuongDoi}": nội dung mới chứa dấu che ${dau.map((d) => `"${d}"`).join(", ")} mà bản gốc không có. ` +
    `Model chỉ nhìn thấy bản ĐÃ CHE của dữ liệu nhạy cảm, nên ghi lúc này sẽ đè dấu che lên giá trị thật trong tệp. ` +
    `Hãy sửa đoạn đó bằng tay hoặc yêu cầu AI không chạm vào phần đã che.`
  );
}
