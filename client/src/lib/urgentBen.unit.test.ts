// URGENT bền (A2(n)) — logic thuần: nhận diện, tách nhóm (KHÔNG bỏ thẻ đã đọc), cắt 3 thẻ + "+N", tuổi, lưới 23 kind × 3 ngôn ngữ,
// và lưới lệch với máy chủ (CANH_BAO_KHONG_RO_KIND) — tự chạy khi nhánh A2(n) đã vào cây, vắng thì bỏ qua (ghi rõ trong tên ca).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import vi from "@/i18n/locales/vi.json";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";
import { KIND_NHAC_GHIM, KIND_URGENT_A2N, TIEN_TO_KIND, TOI_DA_THE_HIEN, catTheHien, duongToiRun, laUrgentA2n, phanNhomUrgent, tuoiNgan, type HangThongBao } from "./urgentBen";

const H37 = `${TIEN_TO_KIND}edge_stream_stuck`;
const hang = (id: number, x: Partial<HangThongBao> = {}): HangThongBao => ({
  id,
  type: "ALERT",
  priority: "URGENT",
  title: `t${id}`,
  message: `m${id}`,
  entityType: "orchestration_run",
  entityId: 400 + id,
  isRead: false,
  readAt: null,
  createdAt: new Date(Date.UTC(2026, 10, 13, 7, 0, id)).toISOString(),
  metadata: { kind: H37 },
  ...x,
});

describe("laUrgentA2n", () => {
  it("URGENT + orchestration_run + kind đúng tiền tố ⇒ có", () => {
    expect(laUrgentA2n(hang(1))).toBe(true);
  });
  it.each([
    ["priority khác", { priority: "HIGH" }],
    ["entityType khác", { entityType: "machine" }],
    ["kind không đúng tiền tố", { metadata: { kind: "other_kind" } }],
    ["không có metadata", { metadata: null }],
    ["metadata.kind không phải chuỗi", { metadata: { kind: 5 } }],
  ])("★ %s ⇒ KHÔNG phải URGENT A2(n)", (_t, x) => {
    expect(laUrgentA2n(hang(1, x as Partial<HangThongBao>))).toBe(false);
  });
  it("kind LẠ nhưng đúng tiền tố ⇒ vẫn là URGENT (hiện bằng title, không bao giờ ẩn), khoaNhan = null", () => {
    const g = phanNhomUrgent([hang(1, { metadata: { kind: `${TIEN_TO_KIND}kind_moi_chua_co_nhan` } })]);
    expect(g.chuaDoc).toHaveLength(1);
    expect(g.chuaDoc[0]!.khoaNhan).toBeNull();
    expect(g.chuaDoc[0]!.title).toBe("t1");
  });
});

describe("phanNhomUrgent", () => {
  it("★ mới nhất trên cùng; hoà createdAt ⇒ id giảm dần", () => {
    const r = phanNhomUrgent([hang(1), hang(3), hang(2), hang(9, { createdAt: hang(3).createdAt })]);
    expect(r.chuaDoc.map((x) => x.id)).toEqual([9, 3, 2, 1]);
  });
  it("★ đã đọc KHÔNG bị bỏ: chuyển sang nhóm daDoc, vẫn còn đủ", () => {
    const r = phanNhomUrgent([hang(1), hang(2, { isRead: true, readAt: "2026-11-13T07:10:00.000Z" })]);
    expect(r.chuaDoc.map((x) => x.id)).toEqual([1]);
    expect(r.daDoc.map((x) => x.id)).toEqual([2]);
    expect(r.daDoc[0]!.readAt).toBe(Date.parse("2026-11-13T07:10:00.000Z"));
  });
  it("hàng không phải URGENT A2(n) bị lọc; runId = entityId", () => {
    const r = phanNhomUrgent([hang(1), hang(2, { priority: "NORMAL" }), hang(3, { entityType: "x" })]);
    expect(r.chuaDoc.map((x) => x.id)).toEqual([1]);
    expect(r.chuaDoc[0]!.runId).toBe(401);
  });
  it("createdAt hỏng / vắng ⇒ không ném, xếp cuối", () => {
    const r = phanNhomUrgent([hang(1, { createdAt: null }), hang(2)]);
    expect(r.chuaDoc.map((x) => x.id)).toEqual([2, 1]);
  });
  it("nhacGhim chỉ cho kind 16–18", () => {
    const r = phanNhomUrgent(KIND_NHAC_GHIM.map((k, i) => hang(i + 1, { metadata: { kind: k } })).concat([hang(9)]));
    expect(r.chuaDoc.filter((x) => x.nhacGhim)).toHaveLength(3);
    expect(r.chuaDoc.find((x) => x.id === 9)!.nhacGhim).toBe(false);
  });
});

describe("catTheHien — tối đa 3 thẻ rồi '+N'", () => {
  const the = phanNhomUrgent([1, 2, 3, 4, 5].map((i) => hang(i))).chuaDoc;
  it("TOI_DA_THE_HIEN = 3 (ghim số)", () => expect(TOI_DA_THE_HIEN).toBe(3));
  it("≤ 3 ⇒ hiện hết, conLai 0", () => {
    expect(catTheHien(the.slice(0, 3), false)).toEqual({ hien: the.slice(0, 3), conLai: 0 });
  });
  it("5 thẻ ⇒ hiện 3 mới nhất, conLai 2", () => {
    const r = catTheHien(the, false);
    expect(r.hien.map((x) => x.id)).toEqual([5, 4, 3]);
    expect(r.conLai).toBe(2);
  });
  it("mở hết ⇒ hiện cả 5", () => {
    expect(catTheHien(the, true)).toEqual({ hien: the, conLai: 0 });
  });
});

describe("tuoiNgan", () => {
  it.each([
    [0, { loai: "giay", n: 0 }],
    [59_999, { loai: "giay", n: 59 }],
    [192_000, { loai: "phut", m: 3, s: 12 }],
    [3_600_000 + 5 * 60_000, { loai: "gio", h: 1, m: 5 }],
    [86_400_000 + 3 * 3_600_000, { loai: "ngay", d: 1, h: 3 }],
    [-5000, { loai: "giay", n: 0 }],
  ])("%d ms ⇒ %j (không bao giờ số âm)", (ms, kq) => expect(tuoiNgan(ms)).toEqual(kq));
});

describe("duongToiRun", () => {
  it("dựng từ runId", () => expect(duongToiRun(412)).toBe("/orchestration-studio?run=412"));
});

describe("lưới 23 kind", () => {
  it("đúng 23 kind, không trùng, đều có tiền tố", () => {
    expect(KIND_URGENT_A2N).toHaveLength(23);
    expect(new Set(KIND_URGENT_A2N).size).toBe(23);
    expect(KIND_URGENT_A2N.every((k) => k.startsWith(TIEN_TO_KIND))).toBe(true);
  });
  it.each([["vi", vi], ["en", en], ["zh", zh]] as const)("★ mỗi kind có nhãn urgent.kind.<kind> không rỗng ở %s", (_ten, loc) => {
    const nhan = (loc as unknown as { urgent: { kind: Record<string, string> } }).urgent.kind;
    for (const k of KIND_URGENT_A2N) expect(typeof nhan[k] === "string" && nhan[k]!.trim().length > 0, k).toBe(true);
    expect(Object.keys(nhan).sort()).toEqual([...KIND_URGENT_A2N].sort()); // không nhãn thừa
  });
  it.each([["vi", vi], ["en", en], ["zh", zh]] as const)("★ nhãn %s không nói 'đã/đang/sẽ dừng' (quy tắc chữ: chỉ nói điều đã quan sát)", (ten, loc) => {
    const nhan = Object.values((loc as unknown as { urgent: { kind: Record<string, string> } }).urgent.kind).join("\n");
    const cam = ten === "vi" ? /\b(đã dừng|đang dừng|sẽ dừng)\b/i : ten === "en" ? /\b(has stopped|is stopping|will stop|was stopped)\b/i : /(已停止|正在停止|将停止)/;
    expect(nhan).not.toMatch(cam);
  });
  it("★ zh không dùng 引脚 (= chân linh kiện phần cứng) cho 'ghim' ở BẤT KỲ khoá urgent nào", () => {
    expect(JSON.stringify((zh as unknown as { urgent: unknown }).urgent)).not.toContain("引脚");
  });

  // Lệch với máy chủ: danh sách kind ở CANH_BAO_KHONG_RO_KIND (foeKetCucKhongRo.ts) — chỉ so được khi tệp nằm trong cây (nhánh A2(n) đã gộp).
  const duongServer = resolve(__dirname, "../../../server/services/orchestration/foe/foeKetCucKhongRo.ts");
  it.skipIf(!existsSync(duongServer))("★ tập kind ở client = CANH_BAO_KHONG_RO_KIND của máy chủ (thiếu/thừa ⇒ đỏ)", () => {
    const src = readFileSync(duongServer, "utf8");
    const i = src.indexOf("CANH_BAO_KHONG_RO_KIND");
    const j = src.indexOf("Object.freeze({", i);
    const k = src.indexOf("})", j);
    const kindServer = [...src.slice(j, k).matchAll(/"(foe_outcome_unknown_[a-z_]+)"/g)].map((m) => m[1]!);
    expect(kindServer.length).toBeGreaterThan(0);
    expect([...KIND_URGENT_A2N].sort()).toEqual([...new Set(kindServer)].sort());
  });
});

describe("nhãn nút tới run nói đúng sự thật", () => {
  it("★ khi trang Orchestration CHƯA đọc ?run=, nhãn KHÔNG hứa 'mở run' (chu-du-an-HST 13/11): 'Mở trang điều phối' / 'Open the orchestration page' / 打开编排页面", () => {
    const u = (l: unknown) => (l as { urgent: { moRun: string } }).urgent.moRun;
    expect(u(vi)).toBe("Mở trang điều phối");
    expect(u(en)).toBe("Open the orchestration page");
    expect(u(zh)).toBe("打开编排页面");
    for (const x of [u(vi), u(en), u(zh)]) expect(x).not.toMatch(/Mở run|Open run|打开运行/);
  });
});
