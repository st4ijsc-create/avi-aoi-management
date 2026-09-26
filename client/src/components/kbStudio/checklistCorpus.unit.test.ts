/**
 * R5 — checklist 4 bước có trạng thái (`checklistCorpusLogic.ts` + `ChecklistCorpusView`).
 * ĐỘT BIẾN PHẢI BẮT: đang tải hiện "chưa" · điểm cũ hơn lần nạp hiện xanh · cảnh báo đỏ của job cũ
 * (đã nạp lại) vẫn kéo trạng thái · job THẤT BẠI sau lượt đo làm điểm "cũ".
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VI = JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "i18n", "locales", "vi.json"), "utf8"));
function tThat(key: string, a?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : undefined) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: tThat, i18n: { language: "vi" } }) }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

const { dungChecklist } = await import("./checklistCorpusLogic");
const { ChecklistCorpusView } = await import("./ChecklistCorpus");
const tt = (b: { trangThai: string }[]) => b.map((x) => x.trangThai);

const CORPUS = [{ name: "st4i", chunkCount: 29, lastIngestAt: "2026-09-23T03:00:00Z" }];
const BO = [{ ten: "st4i", soCauTrong: 30, soDongLoi: 0 }];
const LUOT = [{ trangThai: "xong", createdAt: "2026-09-23T04:00:00Z", tongHop: { trungNguon: 0.9667, duongOng: 0.4 } }];
const JOB_OK = { status: "succeeded", sourceRef: "a.md", createdAt: "2026-09-23T03:00:00Z", ketQuaMay: { canhBao: [] } };

describe("dungChecklist", () => {
  it("chưa nhập tên ⇒ bốn bước 'chưa'", () => {
    expect(tt(dungChecklist({ tenCorpus: "  " }))).toEqual(["chua", "chua", "chua", "chua"]);
  });

  it("đang tải ⇒ 'dang-tai', KHÔNG phải 'chưa'", () => {
    expect(tt(dungChecklist({ tenCorpus: "st4i" }))).toEqual(["dang-tai", "dang-tai", "dang-tai", "dang-tai"]);
  });

  it("đủ bốn bước, điểm mới hơn lần nạp ⇒ bốn 'xong' + điểm thật", () => {
    const b = dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [JOB_OK], boVang: BO, luot: LUOT });
    expect(tt(b)).toEqual(["xong", "xong", "xong", "xong"]);
    expect(b[3].thamSo).toEqual({ trung: "97 %", toi: "40 %" });
  });

  it("nạp THÀNH CÔNG sau lượt đo ⇒ điểm 'canh-bao' (cũ); job THẤT BẠI sau lượt đo thì không", () => {
    const sau = { ...JOB_OK, sourceRef: "b.md", createdAt: "2026-09-23T05:00:00Z" };
    expect(dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [sau, JOB_OK], boVang: BO, luot: LUOT })[3].khoa).toBe("diemCu");
    const hong = { ...sau, status: "failed" };
    expect(dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [hong, JOB_OK], boVang: BO, luot: LUOT })[3].khoa).toBe("diem");
  });

  it("cảnh báo đỏ chỉ tính job MỚI NHẤT của mỗi nguồn (nạp lại tệp đã sửa ⇒ hết cảnh báo)", () => {
    const doCu = { status: "failed", sourceRef: "scan.pdf", createdAt: "2026-09-23T01:00:00Z", ketQuaMay: { canhBao: [{ muc: "do" }] } };
    const moi = { ...JOB_OK, sourceRef: "scan.pdf", createdAt: "2026-09-23T02:00:00Z" };
    expect(dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [moi, doCu], boVang: BO, luot: LUOT })[1].trangThai).toBe("xong");
    expect(dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [doCu], boVang: BO, luot: LUOT })[1]).toMatchObject({ trangThai: "canh-bao", thamSo: { n: 1 } });
  });

  it("corpus mới (chưa đăng ký) · không bộ vàng · bộ vàng lỗi", () => {
    expect(dungChecklist({ tenCorpus: "moi", corpora: CORPUS, jobs: [], boVang: BO, luot: [] }).map((b) => b.khoa)).toEqual(["moi", "chuaNap", "chuaBoVang", "chuaCoDiem"]);
    expect(dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [], boVang: [{ ...BO[0], soDongLoi: 2 }], luot: [] })[2].trangThai).toBe("canh-bao");
  });
});

describe("ChecklistCorpusView — cây thật", () => {
  it("mọi khoá có trong vi.json; trạng thái ra thuộc tính dữ liệu", () => {
    const tatCa = [
      dungChecklist({ tenCorpus: "st4i", corpora: CORPUS, jobs: [JOB_OK], boVang: BO, luot: LUOT }),
      dungChecklist({ tenCorpus: "moi", corpora: CORPUS, jobs: [], boVang: BO, luot: [] }),
      dungChecklist({ tenCorpus: "" }),
      dungChecklist({ tenCorpus: "x" }),
    ];
    for (const b of tatCa) {
      const h = renderToStaticMarkup(createElement(ChecklistCorpusView, { buoc: b }));
      expect(h).not.toContain("‹THIẾU:");
      expect((h.match(/data-buoc=/g) ?? []).length).toBe(4);
    }
    expect(renderToStaticMarkup(createElement(ChecklistCorpusView, { buoc: tatCa[0] }))).toContain("Trúng nguồn 97 % · tới trợ lý 40 %");
  });
});
