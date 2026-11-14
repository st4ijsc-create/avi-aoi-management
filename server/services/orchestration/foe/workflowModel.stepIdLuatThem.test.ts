// Luật ĐẦU VÀO step id MỚI — ba luật thêm: độ dài ≤ 121, cấm tiền tố "abort:", cấm chuỗi "[[A2N". Hàm thuần `kiemTraKyTuIdBuoc`.
// Test thuần: không DB, không mạng. Biên độ dài tính tay từ varchar(128) − "abort:"(6) − 1 dự phòng = 121.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kiemTraKyTuIdBuoc,
  validateWorkflow,
  STEP_ID_TOI_DA,
  TIEN_TO_HANG_ABORT,
  DAU_HIEU_RIENG_STEP_ID,
  LY_DO_I18N_THEO_MA,
  STEP_ID_FORBIDDEN_CHAR,
  STEP_ID_TOO_LONG,
  STEP_ID_ABORT_PREFIX,
  STEP_ID_RESERVED_MARKER,
  type WorkflowDefinition,
} from "./workflowModel";
import { ABORT_ROW_PREFIX } from "./foeRunStore";
import { simulateWorkflow } from "./foeSimulator";
import { deployWorkflow } from "./foeEngine";

const delay = (id: string) => ({ id, type: "delay" as const, ms: 1 });
const defOf = (...steps: unknown[]): WorkflowDefinition => ({ ref: "r", name: "n", steps } as unknown as WorkflowDefinition);
const maOf = (id: string) => kiemTraKyTuIdBuoc(defOf(delay(id))).map((e) => e.code);

afterEach(() => vi.unstubAllEnvs());

describe("hằng số khớp mã nguồn thật", () => {
  it("TIEN_TO_HANG_ABORT = ABORT_ROW_PREFIX của foeRunStore (không lệch hai bản)", () => {
    expect(TIEN_TO_HANG_ABORT).toBe(ABORT_ROW_PREFIX);
    expect(TIEN_TO_HANG_ABORT).toBe("abort:");
  });
  it("giới hạn 121 + tiền tố abort: (6) = 127 ≤ 128 (cột varchar(128))", () => {
    expect(STEP_ID_TOI_DA).toBe(121);
    expect(STEP_ID_TOI_DA + TIEN_TO_HANG_ABORT.length).toBeLessThanOrEqual(128);
  });
  it("dấu rider là đúng chuỗi [[A2N", () => {
    expect(DAU_HIEU_RIENG_STEP_ID).toBe("[[A2N");
  });
});

describe("độ dài: biên 121 qua, 122 bị từ chối", () => {
  it("121 ký tự ⇒ không lỗi", () => {
    expect(maOf("a".repeat(121))).toEqual([]);
  });
  it("122 ký tự ⇒ đúng một lỗi STEP_ID_TOO_LONG nêu độ dài thực 122 và giới hạn 121", () => {
    const e = kiemTraKyTuIdBuoc(defOf(delay("a".repeat(122))));
    expect(e).toHaveLength(1);
    expect(e[0].code).toBe(STEP_ID_TOO_LONG);
    expect(e[0].doDai).toBe(122);
    expect(e[0].toiDa).toBe(121);
    expect(e[0].path).toBe("steps[0].id");
    expect(e[0].message).toContain("122");
    expect(e[0].message).toContain("121");
  });
  it("id rất dài (300) ⇒ thông báo nêu 300, không in nguyên 300 ký tự", () => {
    const e = kiemTraKyTuIdBuoc(defOf(delay("b".repeat(300))));
    expect(e[0].doDai).toBe(300);
    expect(e[0].message.length).toBeLessThan(400);
  });
});

describe('tiền tố "abort:"', () => {
  it('"abort:x" và "abort:" bị từ chối với STEP_ID_ABORT_PREFIX', () => {
    for (const id of ["abort:x", "abort:"]) {
      const e = kiemTraKyTuIdBuoc(defOf(delay(id)));
      expect(e.map((x) => x.code), id).toEqual([STEP_ID_ABORT_PREFIX]);
      expect(e[0].message).toContain("abort:");
    }
  });
  it('"xabort:" (không ở đầu), "abort" (thiếu dấu hai chấm), "Abort:x" (khác hoa thường) ⇒ qua', () => {
    for (const id of ["xabort:", "abort", "abort-x", "Abort:x", "a-abort:b"]) expect(maOf(id), id).toEqual([]);
  });
});

describe('chuỗi "[[A2N"', () => {
  it("ở đầu, giữa, cuối ⇒ bị từ chối với STEP_ID_RESERVED_MARKER", () => {
    for (const id of ["[[A2N", "[[A2Nx", "x[[A2Ny", "x[[A2N"]) {
      const e = kiemTraKyTuIdBuoc(defOf(delay(id)));
      expect(e.map((x) => x.code), id).toEqual([STEP_ID_RESERVED_MARKER]);
      expect(e[0].message).toContain("[[A2N");
    }
  });
  it('gần giống nhưng khác ("[A2N", "[[a2n", "[[A2", "A2N") ⇒ qua', () => {
    for (const id of ["[A2N", "[[a2n", "[[A2", "A2N", "[ [A2N"]) expect(maOf(id), id).toEqual([]);
  });
});

describe("nhiều luật cùng vi phạm ⇒ mỗi luật một lỗi riêng, đúng mã", () => {
  it("abort:, chứa ',', dài 130, chứa [[A2N ⇒ bốn mã", () => {
    const id = `abort:,[[A2N${"z".repeat(125)}`;
    expect(maOf(id).sort()).toEqual([STEP_ID_ABORT_PREFIX, STEP_ID_FORBIDDEN_CHAR, STEP_ID_RESERVED_MARKER, STEP_ID_TOO_LONG].sort());
  });
  it("bảng khoá i18n phủ cả bốn mã", () => {
    expect(LY_DO_I18N_THEO_MA).toEqual({
      STEP_ID_FORBIDDEN_CHAR: "stepIdKyTuCam",
      STEP_ID_TOO_LONG: "stepIdQuaDai",
      STEP_ID_ABORT_PREFIX: "stepIdTienToAbort",
      STEP_ID_RESERVED_MARKER: "stepIdDauHieuRieng",
    });
  });
});

describe("vị trí: compensation và bước lồng cũng bị kiểm ba luật mới", () => {
  it("compensation / sequence.steps / branch.then / branch.else", () => {
    const def = defOf({
      id: "seq",
      type: "sequence",
      steps: [
        { id: "abort:con", type: "delay", ms: 1, compensation: delay("[[A2N-bu") },
        { id: "br", type: "branch", condition: {}, then: [delay("t".repeat(122))], else: [delay("[[A2N")] },
      ],
    });
    const e = kiemTraKyTuIdBuoc(def);
    const theoPath = Object.fromEntries(e.map((x) => [x.path, x.code]));
    expect(theoPath).toEqual({
      "steps[0].steps[0].id": STEP_ID_ABORT_PREFIX,
      "steps[0].steps[0].compensation.id": STEP_ID_RESERVED_MARKER,
      "steps[0].steps[1].then[0].id": STEP_ID_TOO_LONG,
      "steps[0].steps[1].else[0].id": STEP_ID_RESERVED_MARKER,
    });
  });
});

describe("chỉ chặn khi TẠO/SỬA: định nghĩa CŨ có id vi phạm vẫn đọc / chạy / mô phỏng được", () => {
  const cu = defOf(delay("abort:x"), delay("[[A2N"), delay("q".repeat(200)));
  it("validateWorkflow vẫn ok:true (không đổi hành vi)", () => {
    const r = validateWorkflow(cu, null);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("mô phỏng vẫn chạy được", () => {
    expect(simulateWorkflow(cu, {}, {}).ok).toBe(true);
  });
  it("deployWorkflow (đường ghi) từ chối, thông báo chỉ cách sửa ('rename … deploy again')", async () => {
    vi.stubEnv("FOE_ENABLED", "true");
    const r = await deployWorkflow(cu, { id: 1, role: "engineer", name: "e" });
    expect(r.ok).toBe(false);
    expect(r.errors?.map((e) => e.code)).toEqual([STEP_ID_ABORT_PREFIX, STEP_ID_RESERVED_MARKER, STEP_ID_TOO_LONG]);
    expect(r.message).toMatch(/rename the step id, then deploy again/);
  });
});

describe("thông báo cắt id dài: đúng 40 ký tự + dấu … (không in nguyên id)", () => {
  const msgOf = (id: string) => kiemTraKyTuIdBuoc(defOf(delay(id)))[0].message;
  it("id 70 ký tự (chứa ',' ở đầu) ⇒ thông báo có ĐÚNG 40 ký tự đầu + …, không có ký tự thứ 41", () => {
    const id = `,${"abcdefghij".repeat(7).slice(0, 69)}`;
    expect(id).toHaveLength(70);
    const m = msgOf(id);
    expect(m).toContain(JSON.stringify(`${id.slice(0, 40)}…`));
    expect(m).not.toContain(id.slice(0, 41));
  });
  it("biên: id đúng 40 ký tự ⇒ in nguyên, KHÔNG có …; id 41 ký tự ⇒ có …", () => {
    const id40 = `,${"x".repeat(39)}`;
    const id41 = `,${"x".repeat(40)}`;
    expect(msgOf(id40)).toContain(JSON.stringify(id40));
    expect(msgOf(id40)).not.toContain("…");
    expect(msgOf(id41)).toContain(JSON.stringify(`${id41.slice(0, 40)}…`));
  });
});
