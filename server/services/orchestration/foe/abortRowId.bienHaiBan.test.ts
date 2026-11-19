// Lưới giữ cho hàng abort `abort:<stepId>` (cột orchestration_run_steps.stepId varchar(128)):
//  e2 — ca BIÊN của abortRowId (foeEngine.ts): 122 ký tự giữ nguyên (6 + 122 = 128), 123 ký tự bị băm;
//  e6 — HAI BẢN SAO phải cho cùng kết quả: abortRowId (foeEngine.ts) và abortRowIdOf (edge/edgeReportsCentral.ts) cho tới khi gộp về một nguồn.
// Test thuần: không DB, không mạng, không đồng hồ. Giá trị kỳ vọng tính tay từ ĐỊNH NGHĨA, không chép mã:
//   tiền tố "abort:" dài 6 ⇒ id ≤ 122 ký tự cho hàng ≤ 128 nên GIỮ NGUYÊN; id dài hơn ⇒ "abort:" + 111 ký tự đầu + "~" + 10 hex đầu của sha256(CẢ id)
//   (6 + 111 + 1 + 10 = 128). Các chuỗi hex dưới đây tính độc lập bằng Python hashlib.sha256(id).hexdigest()[:10], không bằng mã của repo.
import { describe, expect, it } from "vitest";
import { abortRowId } from "./foeEngine";
import { abortRowIdOf } from "../../edge/edgeReportsCentral";

const k = (n: number) => "k".repeat(n);
/** sha256(k×n)[:10], tính ngoài mã (Python). */
const HEX: Record<number, string> = { 123: "d5f7149138", 128: "69cd344d20", 200: "6de3c28869" };
const HEX_K122_A = "8ec0e124df"; // sha256("k"×122 + "-a")[:10]

describe("e2 — abortRowId: ca biên 122 / 123", () => {
  it("122 ký tự ⇒ GIỮ NGUYÊN: đúng 'abort:' + id, dài 128 (6 + 122), không băm", () => {
    const r = abortRowId(k(122));
    expect(r).toBe(`abort:${k(122)}`);
    expect(r).toHaveLength(128);
    expect(r).not.toContain("~");
  });

  it("121 ký tự ⇒ giữ nguyên (dài 127); 1 ký tự ⇒ 'abort:k'", () => {
    expect(abortRowId(k(121))).toBe(`abort:${k(121)}`);
    expect(abortRowId(k(121))).toHaveLength(127);
    expect(abortRowId("k")).toBe("abort:k");
  });

  it("123 ký tự ⇒ BĂM: dài đúng 128, chứa '~', khác bản thô, bằng 'abort:' + 111 ký tự đầu + '~' + hex tính ngoài", () => {
    const r = abortRowId(k(123));
    expect(r).toHaveLength(128);
    expect(r).toContain("~");
    expect(r).not.toBe(`abort:${k(123)}`);
    expect(r).toBe(`abort:${k(111)}~${HEX[123]}`);
    expect(r.endsWith(`~${HEX[123]}`)).toBe(true);
  });

  it("id dài khác (128 và 200) ⇒ cũng băm đúng khuôn, luôn dài 128", () => {
    expect(abortRowId(k(128))).toBe(`abort:${k(111)}~${HEX[128]}`);
    expect(abortRowId(k(200))).toBe(`abort:${k(111)}~${HEX[200]}`);
  });

  it("hai id dài chung 111+ ký tự đầu nhưng khác phần sau ⇒ hai hàng KHÁC nhau (băm cả id, không cắt)", () => {
    const a = abortRowId(k(123));
    const b = abortRowId(`${k(122)}-a`);
    expect(b).toBe(`abort:${k(111)}~${HEX_K122_A}`);
    expect(a).not.toBe(b);
  });
});

describe("e6 — hai bản sao abortRowId (foeEngine) và abortRowIdOf (edgeReportsCentral) cho CÙNG kết quả", () => {
  const CAC_DO_DAI = [1, 122, 123, 128, 200];
  /** Kỳ vọng tính tay từ định nghĩa cho id toàn 'k'. */
  const ky_vong = (n: number): string => (n <= 122 ? `abort:${k(n)}` : `abort:${k(111)}~${HEX[n]}`);

  for (const n of CAC_DO_DAI) {
    it(`id ${n} ký tự: abortRowId(x) === abortRowIdOf(x), và cả hai bằng kỳ vọng tính tay`, () => {
      const x = k(n);
      expect(abortRowId(x)).toBe(abortRowIdOf(x));
      if (n === 1 || n === 122) expect(abortRowIdOf(x)).toBe(ky_vong(n));
      else if (HEX[n]) expect(abortRowIdOf(x)).toBe(ky_vong(n));
    });
  }

  it("id hỗn hợp (không toàn 'k'): hai bản sao vẫn bằng nhau ở biên 122/123", () => {
    for (const x of [`${k(121)}-`, `${k(122)}`, `${k(122)}-a`, `${k(120)}-b-c`, `ab:${k(121)}`, "a,b", "step-1"]) {
      expect(abortRowId(x), x.slice(0, 20)).toBe(abortRowIdOf(x));
    }
    expect(abortRowIdOf(`${k(122)}-a`)).toBe(`abort:${k(111)}~${HEX_K122_A}`);
  });
});
