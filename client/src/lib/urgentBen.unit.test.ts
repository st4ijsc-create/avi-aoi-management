// URGENT bền (A2(n)) — logic thuần: nhận diện, tách nhóm (KHÔNG bỏ thẻ đã đọc), cắt 3 thẻ + "+N", tuổi, lưới kind × 3 ngôn ngữ,
// và lưới lệch với máy chủ (CANH_BAO_KHONG_RO_KIND) — tự chạy khi nhánh A2(n) đã vào cây, vắng thì bỏ qua (ghi rõ trong tên ca).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import vi from "@/i18n/locales/vi.json";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";
import { KIND_NHAC_GHIM, KIND_URGENT_A2N, KIND_URGENT_EDGE_ABORT, KIND_URGENT_P2, TIEN_TO_KIND, TOI_DA_THE_HIEN, catTheHien, duongToiRun, laUrgentA2n, phanNhomUrgent, tuoiNgan, type HangThongBao } from "./urgentBen";

// Lưới chữ cấm "đã/đang/sẽ dừng" (quy tắc chữ: nhãn chỉ nói điều đã quan sát). MỘT nguồn: vòng soát nhãn và ca "bắt thật" dùng chung hằng này.
// vi KHÔNG dùng \b: \b của JS chỉ coi [A-Za-z0-9_] là chữ nên "đ" không có biên ("máy đã dừng" lọt lưới). So chuỗi con, cờ iu, nhãn + mẫu chuẩn hoá NFC.
const CAM_DUNG = {
  vi: /(đã dừng|đang dừng|sẽ dừng)/iu,
  en: /\b(has stopped|is stopping|will stop|was stopped)\b/i,
  zh: /(已停止|正在停止|将停止)/,
} as const;
const biCam = (ten: keyof typeof CAM_DUNG, chuoi: string): boolean => CAM_DUNG[ten].test(chuoi.normalize("NFC"));

const H37 = `${TIEN_TO_KIND}edge_stream_stuck`;
// Bốn tên P2 chép TAY từ hợp đồng mục (a2) — nguồn kỳ vọng độc lập với KIND_URGENT_P2 của mã.
const BON_KIND_P2 = [
  "foe_compensation_interrupted_held",
  "foe_compensation_interrupted_failed",
  "foe_stop_compensation_resent_at_boot",
  "foe_stop_compensation_pending_at_boot",
] as const;
// X-EDGE-ABORT-TUOI — tên kind chép TAY từ hàng ngoại lệ X-EDGE-ABORT-TUOI — nguồn kỳ vọng độc lập với KIND_URGENT_EDGE_ABORT của mã.
const MOT_KIND_EDGE_ABORT = ["edge_abort_stops_withheld"] as const;
// Hai tên T10 chép TAY từ hợp đồng (hàng 25, 26) — nguồn kỳ vọng độc lập với KIND_URGENT_A2N của mã.
const HAI_KIND_T10 = [
  "foe_outcome_unknown_boot_stop_not_sent_held",
  "foe_outcome_unknown_boot_run_unconfirmed",
] as const;
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
  it.each([
    ["tiền tố ở GIỮA", `x_${TIEN_TO_KIND}edge_stream_stuck`],
    ["tiền tố ở CUỐI", `edge_${TIEN_TO_KIND}`],
    ["tiền tố viết hoa", TIEN_TO_KIND.toUpperCase() + "x"],
    ["tiền tố thiếu dấu _ cuối", "foe_outcome_unknown"],
  ])("★ P3 u3: kind %s ⇒ KHÔNG phải URGENT A2(n) (chỉ startsWith, không includes)", (_t, kind) => {
    expect(laUrgentA2n(hang(1, { metadata: { kind } }))).toBe(false);
  });
  it("kind LẠ nhưng đúng tiền tố ⇒ vẫn là URGENT (hiện bằng title, không bao giờ ẩn), khoaNhan = null", () => {
    const g = phanNhomUrgent([hang(1, { metadata: { kind: `${TIEN_TO_KIND}kind_moi_chua_co_nhan` } })]);
    expect(g.chuaDoc).toHaveLength(1);
    expect(g.chuaDoc[0]!.khoaNhan).toBeNull();
    expect(g.chuaDoc[0]!.title).toBe("t1");
  });
});

describe("URGENT P2 — danh sách ĐÓNG bốn kind (URGENT-P2-KHONG-HIEN)", () => {
  it("★ P2: KIND_URGENT_P2 đúng bốn tên, không trùng, không lẫn vào danh sách A2(n)", () => {
    expect([...(KIND_URGENT_P2 ?? [])].sort()).toEqual([...BON_KIND_P2].sort());
    expect(KIND_URGENT_A2N.filter((k) => (BON_KIND_P2 as readonly string[]).includes(k))).toEqual([]);
  });
  it.each(BON_KIND_P2)("★ P2 nhận: %s ⇒ thuộc vùng bền, có khoá nhãn, không nhắc ghim", (kind) => {
    const h = hang(1, { metadata: { kind } });
    expect(laUrgentA2n(h)).toBe(true);
    const the = phanNhomUrgent([h]).chuaDoc;
    expect(the.map((x) => [x.runId, x.khoaNhan, x.nhacGhim])).toEqual([[401, `urgent.kind.${kind}`, false]]);
  });
  it.each(BON_KIND_P2)("P2 cổng chung: %s với priority hoặc entityType khác ⇒ KHÔNG nhận", (kind) => {
    expect(laUrgentA2n(hang(1, { metadata: { kind }, priority: "HIGH" }))).toBe(false);
    expect(laUrgentA2n(hang(1, { metadata: { kind }, entityType: "machine" }))).toBe(false);
  });
  it.each([
    "foe_stop_compensation_boot",
    "foe_compensation_interrupted_boot",
    "foe_compensation_interrupted_held_x",
    "x_foe_compensation_interrupted_held",
    "foe_compensation_interrupted_",
    "foe_stop_compensation_",
    "FOE_COMPENSATION_INTERRUPTED_HELD",
  ])("★ P2 danh sách đóng: kind lạ cùng họ '%s' ⇒ KHÔNG vào vùng bền", (kind) => {
    expect(laUrgentA2n(hang(1, { metadata: { kind } }))).toBe(false);
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

describe("lưới 26 kind", () => {
  it("đúng 26 kind, không trùng, đều có tiền tố", () => {
    expect(KIND_URGENT_A2N).toHaveLength(26);
    expect(new Set(KIND_URGENT_A2N).size).toBe(26);
    expect(KIND_URGENT_A2N.every((k) => k.startsWith(TIEN_TO_KIND))).toBe(true);
  });
  it.each(HAI_KIND_T10)("★ T10: %s thuộc KIND_URGENT_A2N, có khoá nhãn, không nhắc ghim", (kind) => {
    expect(KIND_URGENT_A2N).toContain(kind);
    const the = phanNhomUrgent([hang(1, { metadata: { kind } })]).chuaDoc;
    expect(the.map((x) => [x.runId, x.khoaNhan, x.nhacGhim])).toEqual([[401, `urgent.kind.${kind}`, false]]);
  });
  it("★ X-EDGE-ABORT-TUOI: KIND_URGENT_EDGE_ABORT = danh sách chép tay; thẻ edge_abort_stops_withheld là URGENT của run, có khoá nhãn, không nhắc ghim", () => {
    expect([...KIND_URGENT_EDGE_ABORT], "danh sách").toEqual([...MOT_KIND_EDGE_ABORT]);
    const h1 = hang(1, { metadata: { kind: "edge_abort_stops_withheld" } });
    expect(laUrgentA2n(h1), "laUrgentA2n").toBe(true);
    const the = phanNhomUrgent([h1]).chuaDoc;
    expect(the.map((x) => [x.runId, x.khoaNhan, x.nhacGhim]), "thẻ").toEqual([[401, "urgent.kind.edge_abort_stops_withheld", false]]);
    // cùng kind trên thực thể KHÁC run ⇒ không phải URGENT của run (một tên, một chỗ)
    expect(laUrgentA2n(hang(2, { entityType: "machine", metadata: { kind: "edge_abort_stops_withheld" } })), "thực thể khác").toBe(false);
  });
  it.each([["vi", vi], ["en", en], ["zh", zh]] as const)("★ mỗi kind có nhãn urgent.kind.<kind> không rỗng ở %s", (_ten, loc) => {
    const nhan = (loc as unknown as { urgent: { kind: Record<string, string> } }).urgent.kind;
    for (const k of [...KIND_URGENT_A2N, ...BON_KIND_P2, ...MOT_KIND_EDGE_ABORT]) expect(typeof nhan[k] === "string" && nhan[k]!.trim().length > 0, k).toBe(true);
    expect(Object.keys(nhan).sort()).toEqual([...KIND_URGENT_A2N, ...BON_KIND_P2, ...MOT_KIND_EDGE_ABORT].sort()); // không nhãn thừa: HỢP ba danh sách (X-EDGE-ABORT-TUOI)
  });
  it.each([["vi", vi], ["en", en], ["zh", zh]] as const)("★ nhãn %s không nói 'đã/đang/sẽ dừng' (quy tắc chữ: chỉ nói điều đã quan sát)", (ten, loc) => {
    const nhan = Object.values((loc as unknown as { urgent: { kind: Record<string, string> } }).urgent.kind).join("\n");
    expect(biCam(ten, nhan), `nhãn ${ten} chứa cụm cấm`).toBe(false);
  });
  it("★ zh không dùng 引脚 (= chân linh kiện phần cứng) cho 'ghim' ở BẤT KỲ khoá urgent nào", () => {
    expect(JSON.stringify((zh as unknown as { urgent: unknown }).urgent)).not.toContain("引脚");
  });

  // Khoá ĐỘNG: VungUrgentBen gọi t(khongTai ? "urgent.khongTai" : "urgent.cu") — i18n:check KHÔNG trích được khoá dạng này,
  // nên đổi tên/xoá khoá ở en/zh sẽ làm người dùng thấy chuỗi khoá thô đúng ở dải cảnh báo thiếu URGENT. Ghim thẳng ở đây.
  it.each([["vi", vi], ["en", en], ["zh", zh]] as const)("★ khoá động urgent.khongTai và urgent.cu có mặt, KHÔNG rỗng ở %s (không lộ chuỗi khoá thô)", (ten, loc) => {
    const u = (loc as unknown as { urgent: Record<string, unknown> }).urgent;
    for (const k of ["khongTai", "cu"]) {
      expect(typeof u[k], `${ten}: urgent.${k}`).toBe("string");
      expect((u[k] as string).trim().length, `${ten}: urgent.${k} rỗng`).toBeGreaterThan(0);
      expect(u[k], `${ten}: urgent.${k} là chuỗi khoá thô`).not.toBe(`urgent.${k}`);
    }
  });
  it("★ zh: hai khoá động không chứa 引脚", () => {
    const u = (zh as unknown as { urgent: { khongTai: string; cu: string } }).urgent;
    expect(u.khongTai).not.toContain("引脚");
    expect(u.cu).not.toContain("引脚");
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

describe("X-EDGE-ABORT-TUOI — lệch với máy chủ", () => {
  const duongEdge = resolve(__dirname, "../../../server/services/edge/edgeConfigCentral.ts");
  it.skipIf(!existsSync(duongEdge))("★ kind mà edgeConfigCentral nâng cho lượt quét bị giữ = KIND_URGENT_EDGE_ABORT (thiếu/thừa ⇒ đỏ)", () => {
    const src = readFileSync(duongEdge, "utf8");
    const kindServer = [...src.matchAll(/kind: "(edge_abort_[a-z_]+)"/g)].map((m) => m[1]!);
    expect([...new Set(kindServer)].sort(), "kind máy chủ").toEqual([...KIND_URGENT_EDGE_ABORT].sort());
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

describe("lưới cấm 'đã/đang/sẽ dừng' phải BẮT thật (URGENTBEN-VI-BIEN-MU)", () => {
  it.each([
    ["vi", "Máy đã dừng"],
    ["vi", "Đã dừng"],
    ["vi", "máy đang dừng"],
    ["vi", "máy sẽ dừng"],
    ["vi", "Máy đã dừng".normalize("NFD")], // dạng tổ hợp rời (ã = a + U+0303): chỉ bắt được khi so NFC
    ["vi", "MÁY ĐANG DỪNG"],
    ["en", "The machine has stopped"],
    ["en", "It is stopping"],
    ["en", "it will stop"],
    ["en", "STOP was stopped"],
    ["en", "THE MACHINE HAS STOPPED"], // chữ HOA hoàn toàn: chỉ bắt được nhờ cờ i của en (URGENTBEN-EN-HOA-CHUA-CA)
    ["en", "IT IS STOPPING"],
    ["zh", "设备已停止"],
    ["zh", "设备正在停止"],
    ["zh", "设备将停止"],
  ] as const)("★ %s: bắt '%s'", (ten, mau) => {
    expect(biCam(ten, mau)).toBe(true);
  });
  it.each([
    ["vi", "Edge chưa xác nhận bước DỪNG; kiểm máy tại chỗ"],
    ["vi", "chưa rõ lệnh nào đã đi"],
    ["vi", "đã giao cho bộ điều phối — máy chưa xác nhận"],
    ["en", "The STOP was handed to the dispatcher — the machine has not confirmed"],
    ["en", "the line will stopover at the buffer"], // "will stop" dính chữ "over": KHÔNG phải cụm cấm, chỉ đúng nhờ \b cuối của en (URGENTBEN-EN-BIEN-CHUA-CA)
    ["en", "his stopping point is the buffer"], // "is stopping" dính chữ "h" phía trước ("his"): chỉ đúng nhờ \b đầu của en
    ["zh", "补偿停止步骤已交给调度器——设备尚未确认"],
  ] as const)("%s: KHÔNG bắt mẫu sạch '%s'", (ten, mau) => {
    expect(biCam(ten, mau)).toBe(false);
  });
});
