/**
 * ★ Đợt 10.3 B1 — vector che DÙNG CHUNG: lưới `cheDuLieu.test.ts`, lưới cổng `congNgoai.test.ts` (đặt từng vector vào
 * system / lịch sử / kết quả tool / schema / tên tệp) và đột biến của kiem-dinh. Khoá giả SINH lúc chạy (không có chuỗi
 * giống khoá thật nằm nguyên trong repo).
 *
 * `phaiKhongCon`: chuỗi KHÔNG được còn trong `JSON.stringify(ketQua)`. `phaiConLai`: chuỗi PHẢI còn (che thừa = lỗi).
 * `cheDo:"schema"` ⇒ đi qua `cheSchemaTool` thay vì `cheGiaTri`.
 */
export interface VectorChe {
  ten: string;
  dauVao: unknown;
  cheDo?: "du-lieu" | "schema";
  phaiKhongCon: string[];
  phaiConLai?: string[];
  /** tên đưa vào từ điển nhạy cho vector này */
  tuDien?: { nguoiDung?: string[]; khach?: string[]; nhaMay?: string[] };
}

export const KHOA_GIA = {
  anthropic: "sk-ant-api03-" + "A".repeat(95),
  openai: "sk-proj-" + "B".repeat(48),
  gemini: "AIza" + "C".repeat(35),
  tuongThich: "sk-" + "D".repeat(48),
} as const;

export const VECTOR_CHE: readonly VectorChe[] = [
  { ten: "json-nhay", dauVao: { password: "P@ssw0rd!x", apiKey: "k-1234567" }, phaiKhongCon: ["P@ssw0rd!x", "k-1234567"] },
  {
    ten: "long-sau",
    dauVao: { a: [{ b: { Api_Key: "vx-secret-1" } }], headers: { "x-api-key": "vy-secret-2", Authorization: "Bearer abcdefghijklmnop1234" } },
    phaiKhongCon: ["vx-secret-1", "vy-secret-2", "abcdefghijklmnop1234"],
    phaiConLai: ["Api_Key", "x-api-key", "Authorization"],
  },
  { ten: "khoa-anthropic", dauVao: `dung khoa ${KHOA_GIA.anthropic} nhe`, phaiKhongCon: [KHOA_GIA.anthropic, "A".repeat(40)] },
  { ten: "khoa-openai", dauVao: `OPENAI=${KHOA_GIA.openai}`, phaiKhongCon: [KHOA_GIA.openai, "B".repeat(40)] },
  { ten: "khoa-gemini", dauVao: { cfg: `k ${KHOA_GIA.gemini}` }, phaiKhongCon: [KHOA_GIA.gemini] },
  { ten: "khoa-tuong-thich", dauVao: [`${KHOA_GIA.tuongThich}`], phaiKhongCon: [KHOA_GIA.tuongThich, "D".repeat(40)] },
  { ten: "ip-noi-bo", dauVao: "PLC 10.1.2.3, HMI 192.168.0.10, link fe80::1 ok", phaiKhongCon: ["10.1.2.3", "192.168.0.10", "fe80::1"], phaiConLai: ["PLC", "HMI"] },
  { ten: "mac", dauVao: "MAC 00:1A:2B:3C:4D:5E va 00-1a-2b-3c-4d-5f", phaiKhongCon: ["00:1A:2B:3C:4D:5E", "00-1a-2b-3c-4d-5f"] },
  { ten: "user-nhan", dauVao: "dang nhap user=engineer1 that bai", phaiKhongCon: ["engineer1"], phaiConLai: ["user=", "that bai"] },
  { ten: "rong-0", dauVao: "pa​ssword=abc123xyz", phaiKhongCon: ["abc123xyz"] },
  { ten: "chu-tach", dauVao: "p a s s w o r d: hunter2zz", phaiKhongCon: ["hunter2zz"] },
  { ten: "ten-khach", dauVao: "lỗi đơn ACME Co tuần này", tuDien: { khach: ["ACME Co"] }, phaiKhongCon: ["ACME Co"], phaiConLai: ["lỗi đơn", "tuần này"] },
  { ten: "env-tien-to", dauVao: "DB_PASSWORD=Sup3rSecret99\nMYSQL_PWD=abc12345\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG", phaiKhongCon: ["Sup3rSecret99", "abc12345", "wJalrXUtnFEMI/K7MDENG", "K7MDENG"], phaiConLai: ["DB_PASSWORD=", "MYSQL_PWD=", "AWS_SECRET_ACCESS_KEY="] },
  { ten: "cap-ten-gia-tri", dauVao: [{ name: "DB_PASSWORD", value: "x9x9x9" }, { header: "Authorization", value: "Bearer zzzzzzzzzzzzzzzzz" }], phaiKhongCon: ["x9x9x9", "zzzzzzzzzzzzzzzzz"], phaiConLai: ["DB_PASSWORD"] },
  { ten: "basic", dauVao: "Authorization: Basic dXNlcjpwYXNzd29yZA==", phaiKhongCon: ["dXNlcjpwYXNzd29yZA=="] },
  { ten: "query-url", dauVao: "goi https://h.example/x?token=abcd1234&api_key=efgh5678&page=2", phaiKhongCon: ["abcd1234", "efgh5678"], phaiConLai: ["page=2", "https://h.example/x?token="] },
  { ten: "yaml-nhieu-dong", dauVao: "db:\n  password: Sup3rYaml\n  host: x\n  secret: 'q q q'\n", phaiKhongCon: ["Sup3rYaml", "q q q"], phaiConLai: ["host: x"] },
  { ten: "json-hai-lop", dauVao: JSON.stringify(JSON.stringify({ password: "p2p2p2" })), phaiKhongCon: ["p2p2p2"] },
  { ten: "cyrillic", dauVao: "pаssword=hunter22", phaiKhongCon: ["hunter22"] },
  { ten: "fullwidth", dauVao: "ｐａｓｓｗｏｒｄ=hunter33", phaiKhongCon: ["hunter33"] },
  { ten: "phan-tram", dauVao: "q=%70assword=hunter44", phaiKhongCon: ["hunter44"] },
  { ten: "nhieu-dong", dauVao: "dong 1\ndong 2\napi_key=ABCDEFGH12345678\ndong 4\ndong 5", phaiKhongCon: ["ABCDEFGH12345678"], phaiConLai: ["dong 4", "dong 5"] },
  // ── rà kiem-dinh lô 1 (A–E, G) ──
  { ten: "cookie", dauVao: "Cookie: session=abc123def456; theme=dark\nSet-Cookie: sid=zzz999yyy888; Path=/\nCookie: theme=dark; sid=abc123def457", phaiKhongCon: ["abc123def456", "zzz999yyy888", "abc123def457"] },
  {
    ten: "gia-tri-co-cham",
    dauVao:
      "secret=my.company.secret\napi_secret: v1.public.AbCdEf123456\ntoken=Zz9988.abc.def\nclient_secret=abc.def.ghi\n" +
      "SESSION_TOKEN=a1b2.c3d4.e5f6\nDB_PASSWORD=my.db.pass\nrefresh_token: tok_live.abcd.efgh\ntoken=abc(def123",
    phaiKhongCon: ["my.company.secret", "v1.public.AbCdEf123456", "Zz9988.abc.def", "abc.def.ghi", "a1b2.c3d4.e5f6", "my.db.pass", "tok_live.abcd.efgh", "abc(def123"],
  },
  {
    ten: "ma-that-giu-nguyen",
    dauVao: "const pw = req.body.password;\ntoken = process.env.TOKEN\ntoken: string | null;\nsecret: ${{ secrets.DEPLOY_KEY }}\nDB_PASSWORD=$DB_PASS",
    phaiKhongCon: [],
    phaiConLai: ["req.body.password", "process.env.TOKEN", "string | null", "${{ secrets.DEPLOY_KEY }}", "$DB_PASS"],
  },
  { ten: "nhieu-tu-khong-nhay", dauVao: "password: correct horse battery staple\nhost: db1", phaiKhongCon: ["correct", "horse battery staple"], phaiConLai: ["host: db1"] },
  {
    ten: "tieng-viet",
    dauVao: "mật khẩu: Abc12345!\nmat khau = Qq778899\nmk: Ww665544\nMật khẩu của tôi là Zz998877.\nMã PIN của máy: 4821\nPIN: 9137\nmã OTP là 556677",
    phaiKhongCon: ["Abc12345!", "Qq778899", "Ww665544", "Zz998877", "4821", "9137", "556677"],
    phaiConLai: ["Mật khẩu của tôi là", "Mã PIN của máy:"],
  },
  { ten: "tieng-viet-giu-nguyen", dauVao: "Mức pin: 80%\nĐèn báo pin: 13\nmk ổn", phaiKhongCon: [], phaiConLai: ["Mức pin: 80%", "pin: 13", "mk ổn"] },
  {
    ten: "webhook",
    dauVao:
      "slack https://hooks.slack.com/services/" + "T0AAA/B0BBB/" + "z".repeat(24) +
      "\ndiscord https://discord.com/api/webhooks/123456789012345678/" + "dScrt-" + "q".repeat(30) +
      "\nteams https://acme.webhook.office.com/webhookb2/aaaa-bbbb@cccc/IncomingWebhook/" + "t".repeat(20) +
      "\ntele " + "1234567890:" + "T".repeat(35),
    phaiKhongCon: ["z".repeat(24), "q".repeat(30), "t".repeat(20), "T".repeat(35)],
    phaiConLai: ["https://hooks.slack.com/services/"],
  },
  { ten: "sau-70", dauVao: Array.from({ length: 70 }).reduce<unknown>((acc) => ({ a: acc }), { password: "deep-secret-70" }), phaiKhongCon: ["deep-secret-70"] },
  {
    ten: "sau-70-chuoi-json",
    dauVao: Array.from({ length: 70 }).reduce<unknown>((acc) => ({ a: acc }), JSON.stringify(JSON.stringify(JSON.stringify({ token: "deep-json-70" })))),
    phaiKhongCon: ["deep-json-70"],
  },
  // ── rà kiem-dinh lô 1, điểm 2–3 ──
  { ten: "duoi-pass", dauVao: "DB_PASS=hunter2\ndb_pass: hunter3x\nroot_pass = hunter4y", phaiKhongCon: ["hunter2", "hunter3x", "hunter4y"] },
  {
    ten: "duoi-pass-json",
    dauVao: { mysql_pass: "hunter5z", qc_pass: true, line_pass: "PASSED", test_pass: 97 },
    phaiKhongCon: ["hunter5z"],
    phaiConLai: ['"qc_pass":true', '"line_pass":"PASSED"', '"test_pass":97'],
  },
  {
    ten: "viet-chen-danh-tu",
    dauVao: "mật khẩu wifi là Zz99887766\nmật khẩu admin là Ab#12345\nmật khẩu máy chủ là Srv2026!x",
    phaiKhongCon: ["Zz99887766", "Ab#12345", "Srv2026!x"],
  },
  // ── giữ nguyên (che thừa = lỗi) ──
  { ten: "pass-qc-giu-nguyen", dauVao: { pass: true, status: "Pass: PASSED", note: "pass = 1" }, phaiKhongCon: [], phaiConLai: ['"pass":true', "Pass: PASSED", "pass = 1"] },
  { ten: "viet-van-xuoi-giu-nguyen", dauVao: "mật khẩu là gì?\nmật khẩu mạnh là mật khẩu dài", phaiKhongCon: [], phaiConLai: ["mật khẩu là gì?", "mật khẩu mạnh là mật khẩu dài"] },
  { ten: "ip-cong-khai-giu-nguyen", dauVao: "DNS 8.8.8.8", phaiKhongCon: [], phaiConLai: ["8.8.8.8"] },
  { ten: "ma-nguon-giu-nguyen", dauVao: "const x = 1;\nconst pw = req.body.password;\ninterface A { token: string }", phaiKhongCon: [], phaiConLai: ["const x = 1;", "req.body.password", "token: string"] },
  { ten: "qc-pass", dauVao: { passed: 12, passRate: 0.97, status: "Pass: PASSED" }, phaiKhongCon: [], phaiConLai: ['"passed":12', '"passRate":0.97', "Pass: PASSED"] },
  { ten: "max-tokens", dauVao: { maxTokens: 512, tokenCount: 30, tokensOut: 4, tokenizer: "bpe" }, phaiKhongCon: [], phaiConLai: ['"maxTokens":512', '"tokenCount":30', '"tokensOut":4', '"tokenizer":"bpe"'] },
  {
    ten: "schema-tool",
    cheDo: "schema",
    dauVao: { type: "object", properties: { token: { type: "string", description: `vd ${KHOA_GIA.anthropic}` }, password: { type: "string" } }, required: ["token"] },
    phaiKhongCon: [KHOA_GIA.anthropic],
    phaiConLai: ['"token":{"type":"string"', '"password":{"type":"string"}', '"required":["token"]'],
  },
  { ten: "tu-dung", dauVao: "admin vao nha may A1 luc 8h", tuDien: { nguoiDung: ["admin"], nhaMay: ["A1"] }, phaiKhongCon: [], phaiConLai: ["admin", "A1"] },
];
