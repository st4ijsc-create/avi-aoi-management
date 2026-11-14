// Luật ĐẦU VÀO step id MỚI — hàm thuần `kiemTraKyTuIdBuoc` (workflowModel.ts) + bằng chứng đường ĐỌC/CHẠY không bị ảnh hưởng.
// Test thuần: không DB, không mạng, không thiết bị.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kiemTraKyTuIdBuoc,
  validateWorkflow,
  KY_TU_CAM_TRONG_STEP_ID,
  STEP_ID_FORBIDDEN_CHAR,
  type WorkflowDefinition,
} from "./workflowModel";
import { simulateWorkflow } from "./foeSimulator";
import { deployWorkflow } from "./foeEngine";

const delay = (id: string) => ({ id, type: "delay" as const, ms: 1 });
const defOf = (...steps: unknown[]): WorkflowDefinition => ({ ref: "r", name: "n", steps } as unknown as WorkflowDefinition);

afterEach(() => vi.unstubAllEnvs());

describe("kiemTraKyTuIdBuoc — mỗi ký tự cấm bị bắt, nêu đúng ký tự và vị trí", () => {
  const CAC_CA: Array<[string, string]> = [
    [",", '","'],
    ["(", '"("'],
    [")", '")"'],
    ["\n", "line feed"],
    ["\r", "carriage return"],
  ];
  for (const [ky, ten] of CAC_CA) {
    it(`id "x${JSON.stringify(ky).slice(1, -1)}y" ⇒ đúng MỘT lỗi tại steps[0].id, code ${STEP_ID_FORBIDDEN_CHAR}, nêu ${ten}`, () => {
      const e = kiemTraKyTuIdBuoc(defOf(delay(`x${ky}y`)));
      expect(e).toHaveLength(1);
      expect(e[0].path).toBe("steps[0].id");
      expect(e[0].code).toBe(STEP_ID_FORBIDDEN_CHAR);
      expect(e[0].kyTu).toContain(ten);
      expect(e[0].message).toContain(ten);
      expect(e[0].message).toContain("steps[0].id");
    });
  }

  it("danh sách ký tự cấm đúng năm ký tự của đề", () => {
    expect(KY_TU_CAM_TRONG_STEP_ID.map((k) => k.ky)).toEqual([",", "(", ")", "\n", "\r"]);
  });

  it("id hợp lệ bình thường (chữ, số, gạch, chấm, khoảng trắng, dấu hai chấm) ⇒ không lỗi", () => {
    expect(kiemTraKyTuIdBuoc(defOf(delay("buoc-1"), delay("Step_2.a"), delay("co khoang trang"), delay("a:b"), delay("a;b")))).toEqual([]);
  });

  it("nhiều ký tự trong MỘT id ⇒ MỘT lỗi liệt kê tất cả; nhiều step xấu ⇒ mỗi step một lỗi", () => {
    const e = kiemTraKyTuIdBuoc(defOf(delay("a,b)"), delay("tot"), delay("c(d")));
    expect(e.map((x) => x.path)).toEqual(["steps[0].id", "steps[2].id"]);
    expect(e[0].kyTu).toBe('"," and ")"');
    expect(e[1].kyTu).toBe('"("');
  });

  it("vị trí lồng nhau: sequence.steps / branch.then / branch.else / compensation đều có path đúng", () => {
    const def = defOf({
      id: "seq",
      type: "sequence",
      steps: [
        delay("ok"),
        { id: "br", type: "branch", condition: {}, then: [delay("t,1")], else: [delay("e)1")], compensation: delay("c(1") },
      ],
      compensation: delay("goc\n1"),
    });
    expect(kiemTraKyTuIdBuoc(def).map((x) => x.path).sort()).toEqual(
      [
        "steps[0].compensation.id",
        "steps[0].steps[1].compensation.id",
        "steps[0].steps[1].else[0].id",
        "steps[0].steps[1].then[0].id",
      ].sort(),
    );
  });

  it("định nghĩa méo không ném lỗi (null, không phải mảng, step null, id không phải chuỗi)", () => {
    expect(() => kiemTraKyTuIdBuoc(null as never)).not.toThrow();
    expect(kiemTraKyTuIdBuoc({ ref: "r", name: "n", steps: "x" } as never)).toEqual([]);
    expect(kiemTraKyTuIdBuoc(defOf(null, 5, { id: 7, type: "delay", ms: 1 }))).toEqual([]);
  });
});

describe("đường ĐỌC / CHẠY / MÔ PHỎNG không bị chặn: định nghĩa CŨ có id xấu vẫn dùng được", () => {
  const cu = defOf(delay("a,b"), delay("c)d"));

  it("validateWorkflow KHÔNG đổi hành vi: vẫn ok:true cho định nghĩa cũ", () => {
    const r = validateWorkflow(cu, null);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("mô phỏng (simulateWorkflow) vẫn chạy được định nghĩa cũ", () => {
    const r = simulateWorkflow(cu, {}, {});
    expect(r.ok).toBe(true);
  });
});

describe("deployWorkflow (một cửa chung của tRPC, API v1, rollback, loader): từ chối TRƯỚC khi chạm DB", () => {
  it("FOE bật + id chứa ',' ⇒ ok:false, errors nêu steps[0].id; không cần DB", async () => {
    vi.stubEnv("FOE_ENABLED", "true");
    const r = await deployWorkflow(defOf(delay("a,b")), { id: 1, role: "engineer", name: "e" });
    expect(r.ok).toBe(false);
    expect(r.enabled).toBe(true);
    expect(r.errors?.[0].path).toBe("steps[0].id");
    expect(r.errors?.[0].code).toBe(STEP_ID_FORBIDDEN_CHAR);
    expect(r.message).toContain('","');
  });

  it("FOE tắt ⇒ vẫn là từ chối 'disabled' như cũ (luật mới không đổi cổng cờ)", async () => {
    vi.stubEnv("FOE_ENABLED", "false");
    const r = await deployWorkflow(defOf(delay("a,b")), { id: 1, role: "engineer", name: "e" });
    expect(r.ok).toBe(false);
    expect(r.enabled).toBe(false);
  });
});
