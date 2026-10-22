/**
 * ★ Đợt 9 — BẢN CHÍNH `sclSangSt.ts` ≡ bản chép của bộ đo `scripts/ai-eval/ngau-nhien/lib/st-scl/scl.mjs` (node thuần không
 * import được .ts). Chạy trên MỌI mã thật có trên máy: 30 lời giải SCL viết tay (mau-scl), lời giải mẫu ST của kho, và mọi
 * tệp mã trong câu trả lời THẬT đã lưu ở `scripts/ai-eval/ngau-nhien/reports/*.json` (thư mục .gitignore — có thì chạy).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dauHieuScl, sclSangSt } from "./sclSangSt";
// @ts-expect-error — mô-đun .mjs của bộ đo, không có khai báo kiểu
import * as banChep from "../../../../scripts/ai-eval/ngau-nhien/lib/st-scl/scl.mjs";

const GOC = path.resolve(__dirname, "../../../../scripts/ai-eval/ngau-nhien");

function tepTrongThuMuc(goc: string, loc: (p: string) => boolean): string[] {
  if (!fs.existsSync(goc)) return [];
  const ra: string[] = [];
  for (const ten of fs.readdirSync(goc, { withFileTypes: true })) {
    const p = path.join(goc, ten.name);
    if (ten.isDirectory()) ra.push(...tepTrongThuMuc(p, loc));
    else if (loc(p)) ra.push(p);
  }
  return ra;
}

/** Ca TỔNG HỢP phủ nhánh mà kho thật chưa có (DB toàn cục có chấm, CTUD_INT, IEC_COUNTER, SEL/MUX hình thức, chuỗi/chú thích). */
const TONG_HOP = [
  '#v := "DB_May".tocDo + "G_NOW"; #c(CU := TRUE); x : IEC_COUNTER; #c.CTUD(CU := #a); y : CTUD_INT;',
  "#r := SEL(G := #c, IN0 := 1, IN1 := 2); #m := MUX(K := 1, IN0 := #a, IN1 := #b); #l := LIMIT(MX := 9, IN := #v, MN := 0);",
  "#s := '#khong \"doi\"'; // #chu thich \"x\"\n(* #k *) REGION a\n  #q := TRUE;\nEND_REGION;\nVERSION : 0.1",
  "FUNCTION \"F\" : Int\nVAR_TEMP t : Int; END_VAR\nBEGIN\n  #F := MIN(IN2 := #b, IN1 := MAX(IN1 := #a, IN2 := 0));\nEND_FUNCTION",
];

function kho(): string[] {
  const ds: string[] = [...TONG_HOP];
  for (const p of tepTrongThuMuc(path.join(GOC, "lib/st-scl/mau-scl"), (x) => x.endsWith(".st"))) ds.push(fs.readFileSync(p, "utf8"));
  for (const p of tepTrongThuMuc(path.join(GOC, "kho"), (x) => /[\\/]mau[\\/]src[\\/].*\.st$/.test(x))) ds.push(fs.readFileSync(p, "utf8"));
  for (const p of tepTrongThuMuc(path.join(GOC, "reports"), (x) => x.endsWith(".json"))) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const r of j.rows ?? []) for (const nd of Object.values(r.tep ?? {})) if (typeof nd === "string" && nd.trim()) ds.push(nd);
    } catch {
      /* báo cáo hỏng — bỏ qua */
    }
  }
  return ds;
}

describe("sclSangSt — bản server (chính) ≡ bản chép bộ đo", () => {
  const ds = kho();
  it(`trên ${ds.length} mã thật: cùng đầu ra sclSangSt + dauHieuScl`, () => {
    expect(ds.length).toBeGreaterThanOrEqual(60); // mau-scl 30 + mẫu kho ST ⇒ tối thiểu; reports có thì nhiều hơn
    let lech = 0;
    const viDu: string[] = [];
    for (const ma of ds) {
      if (sclSangSt(ma) !== banChep.sclSangSt(ma) || JSON.stringify(dauHieuScl(ma)) !== JSON.stringify(banChep.dauHieuScl(ma))) {
        lech++;
        if (viDu.length < 3) viDu.push(ma.slice(0, 120));
      }
    }
    expect({ lech, viDu }).toEqual({ lech: 0, viDu: [] });
  });
});
