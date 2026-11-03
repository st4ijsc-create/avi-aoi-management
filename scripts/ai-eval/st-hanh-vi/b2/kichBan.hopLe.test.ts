/**
 * ★ Đợt 12 B2 — kiểm HÌNH THỨC kịch bản đăng ký trước (KHÔNG chạy lời giải nào): mỗi bài ST của kho có đúng một kịch bản, khối = `dinhDanh`,
 * mọi tên chân có trong giao diện KHUNG, mỗi đoạn có kiểm, bộ bọc + KHUNG (không phải lời giải) biên dịch và quét được trên OIP.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chamLoiGiai, docGiaoDien, docKichBan, doiBuoc, GOC_KHO, THU_MUC_KICH_BAN } from "./boBocBai";

const BAI = fs.readdirSync(GOC_KHO).filter((d) => d.startsWith("st-")).sort();
const KB = fs.readdirSync(THU_MUC_KICH_BAN).filter((t) => t.endsWith(".json")).map((t) => t.replace(/\.json$/, "")).sort();

describe("B2 — kịch bản đăng ký trước: hình thức", () => {
  it("kho có 30 bài ST; mỗi bài đúng một kịch bản, không kịch bản lạ", () => {
    expect(BAI).toHaveLength(30);
    expect(KB).toEqual(BAI);
  });

  for (const id of KB) {
    it(`${id}: khối = dinhDanh, tên chân hợp lệ, mỗi đoạn có kiểm, bộ bọc + KHUNG biên dịch + quét được`, () => {
      const kb = docKichBan(id);
      const bai = JSON.parse(fs.readFileSync(path.join(GOC_KHO, id, "bai.json"), "utf8")) as { dinhDanh: string; tepGiai: string[] };
      expect(kb.id).toBe(id);
      expect(kb.khoi).toBe(bai.dinhDanh);
      expect(kb.nguon.length).toBeGreaterThan(10);
      expect(kb.suaSau ?? []).toEqual([]);
      const g = docGiaoDien(id, kb.khoi);
      expect(kb.doan.length).toBeGreaterThan(0);
      for (const d of kb.doan) {
        expect(d.buoc.length, d.ten).toBeGreaterThan(0);
        expect(d.buoc.reduce((s, b) => s + Object.keys(b.ky ?? {}).length, 0), `${d.ten}: không có kiểm`).toBeGreaterThan(0);
        for (const b of d.buoc) {
          expect(b.dtMs).toBeGreaterThanOrEqual(0);
          doiBuoc(g, b);
        }
      }
      const khung = bai.tepGiai.map((t) => fs.readFileSync(path.join(GOC_KHO, id, "khung", t), "utf8")).join("\n");
      const kq = chamLoiGiai(kb, khung);
      expect(kq.loi, "bộ bọc + khung phải biên dịch / quét được (lệch giá trị là chuyện của khung, không kiểm ở đây)").toBeUndefined();
    });
  }
});
