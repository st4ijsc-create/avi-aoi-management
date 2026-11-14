/**
 * Họ đầu vào XẤU cho bộ che `cheDuLieu.cheChuoi` (ReDoS / bậc hai) — MỘT nguồn cho:
 *   · ca thời gian `cheDuLieu.test.ts` ("thời gian TUYẾN TÍNH với đầu vào xấu", rà kiem-dinh F);
 *   · ca tất định `cheDuLieu.redos.test.ts` (A2 — công regex tuyến tính theo n).
 * Mỗi họ: (tên, n ⇒ chuỗi có độ dài ~ tỉ lệ n). Thêm họ mới ở ĐÂY, cả hai ca tự có. Thuần, không import.
 */
export const HO_XAU: Array<[string, (n: number) => string]> = [
  ["10.1.1.", (n) => "10.1.1.".repeat(n)],
  ["a.", (n) => "a.".repeat(n)],
  ["Ab.", (n) => "Ab.".repeat(n)],
  ["1.", (n) => "1.".repeat(n)],
  ["a-…%", (n) => "a-".repeat(n) + "%"],
  ["a…%", (n) => "a".repeat(n) + "%"],
  ["%41a…%", (n) => "%41a".repeat(n) + "%"],
  ["x://a:b", (n) => "x://a:b".repeat(n)],
  ["x://a:b␠", (n) => "x://a:b ".repeat(n)],
  ["PEM không END", (n) => "-----BEGIN RSA PRIVATE KEY-----\n".repeat(Math.ceil(n / 4))],
  ["a␠", (n) => "a ".repeat(n)],
  ["p a s s␠", (n) => "p a s s ".repeat(Math.ceil(n / 4))],
  ["user=a@", (n) => "user=a@".repeat(n)],
  ["password: x␠", (n) => "password: x ".repeat(Math.ceil(n / 4))],
  ["token=", (n) => "token=".repeat(n)],
  ["a:b␠", (n) => "a:b ".repeat(n)],
  ["mật khẩu␠", (n) => "mật khẩu ".repeat(Math.ceil(n / 4))],
  ["eyJ…", (n) => "eyJaaaaaaaa.".repeat(Math.ceil(n / 4))],
  ["Bearer␠", (n) => "Bearer ".repeat(n)],
  // rà kiem-dinh lần 2 — họ xấu cho 3 luật mới (khối nhiều dòng, hex có ngăn, bảng base64 không neo)
  ["aa:", (n) => "aa:".repeat(n)],
  ["aa␠", (n) => "aa ".repeat(n)],
  ["aa:…899 x", (n) => ("aa:".repeat(899) + "x").repeat(Math.ceil(n / 900))],
  ["dòng b64 41 ×11 + x", (n) => (("A".repeat(41) + "\n").repeat(11) + "x\n").repeat(Math.ceil(n / 12))],
  ["dòng b64 39", (n) => ("A".repeat(39) + "\n").repeat(Math.ceil(n / 4))],
  ["b64 1999 + .", (n) => ("A".repeat(1999) + ".").repeat(Math.ceil(n / 400))],
];
