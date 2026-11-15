/**
 * (HST 15/11) cờ ÉP ĐO `AI_AGENT_NGAN_SACH_EP` — CHỈ HẠ ngân sách ngữ cảnh của vòng agent (máy đo :3013), áp ở MỘT chỗ (nganSachNguCanh.ts).
 * ĐỘT BIẾN PHẢI ĐỎ: "cho phép nâng" (bỏ chốt ep >= thật) · "bỏ kẹp dưới 8 192" · "áp cả khi vắng" (mặc định một số khi biến vắng) ·
 * "không đọc env" (bỏ tham số env của nganSachNguCanhCho) · "nhận thập phân/âm".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { apNganSachEp, nganSachEpTuEnv, nganSachNguCanhCho, NGAN_SACH_EP_TOI_THIEU, _datLaiCanhBaoNganSach } from "./nganSachNguCanh";

const QWEN = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const dep = (nCtx: number | null | "nem", ten = QWEN) => ({
  nCtxKhe: async () => {
    if (nCtx === "nem") throw new Error("mạng");
    return nCtx;
  },
  tenModelMacDinh: () => ten,
});
const env = (v?: string) => (v === undefined ? {} : { AI_AGENT_NGAN_SACH_EP: v });

beforeEach(() => _datLaiCanhBaoNganSach());

describe("nganSachEpTuEnv — chỉ số nguyên dương; còn lại như vắng", () => {
  it("số nguyên dương (kể cả có khoảng trắng hai đầu)", () => {
    expect(nganSachEpTuEnv("28672")).toBe(28_672);
    expect(nganSachEpTuEnv(" 28672 ")).toBe(28_672);
    expect(nganSachEpTuEnv("1")).toBe(1);
  });
  it.each([undefined, "", "   ", "0", "-1", "-28672", "28672.5", "1e4", "abc", "28 672", "0x7000", "+28672", "Infinity", "99999999999999999999"])(
    "%j ⇒ undefined",
    (v) => {
      expect(nganSachEpTuEnv(v)).toBeUndefined();
    },
  );
});

describe("apNganSachEp — chỉ HẠ, kẹp dưới, không vượt thật", () => {
  it("vắng ⇒ y nguyên", () => {
    expect(apNganSachEp(65_536, undefined)).toBe(65_536);
  });
  it("nhỏ hơn thật ⇒ dùng ép", () => {
    expect(apNganSachEp(65_536, 28_672)).toBe(28_672);
  });
  it("bằng hoặc lớn hơn thật ⇒ bỏ qua (KHÔNG nâng)", () => {
    expect(apNganSachEp(65_536, 65_536)).toBe(65_536);
    expect(apNganSachEp(65_536, 100_000)).toBe(65_536);
    expect(apNganSachEp(32_768, 40_000)).toBe(32_768);
  });
  it("dưới kẹp ⇒ kẹp lên 8 192", () => {
    expect(NGAN_SACH_EP_TOI_THIEU).toBe(8_192);
    expect(apNganSachEp(65_536, 4_096)).toBe(8_192);
    expect(apNganSachEp(65_536, 1)).toBe(8_192);
  });
  it("ngân sách thật nhỏ hơn kẹp ⇒ vẫn không vượt thật", () => {
    expect(apNganSachEp(512, 4_096)).toBe(512);
  });
});

describe("nganSachNguCanhCho — cờ áp sau phép lấy số nhỏ hơn (mô tả, khe)", () => {
  it("vắng ⇒ như trước cờ (65 536 / 32 768 / khe lỗi ⇒ mô tả)", async () => {
    expect(await nganSachNguCanhCho(undefined, dep(65_536), env())).toBe(65_536);
    expect(await nganSachNguCanhCho(undefined, dep(null), env())).toBe(65_536);
    expect(await nganSachNguCanhCho(undefined, dep("nem"), env())).toBe(65_536);
    expect(await nganSachNguCanhCho("Qwen3-4B-Instruct-2507", dep(65_536), env())).toBe(32_768);
  });
  it("28 672 ⇒ 28 672 ở mọi đường (khe đọc được / null / ném)", async () => {
    expect(await nganSachNguCanhCho(undefined, dep(65_536), env("28672"))).toBe(28_672);
    expect(await nganSachNguCanhCho(undefined, dep(null), env("28672"))).toBe(28_672);
    expect(await nganSachNguCanhCho(undefined, dep("nem"), env("28672"))).toBe(28_672);
  });
  it("ép lớn hơn số nhỏ hơn của (mô tả, khe) ⇒ dùng số thật; ép nhỏ hơn ⇒ dùng ép", async () => {
    const w = console.warn;
    console.warn = () => undefined;
    try {
      expect(await nganSachNguCanhCho(undefined, dep(32_768), env("40000"))).toBe(32_768);
      expect(await nganSachNguCanhCho(undefined, dep(32_768), env("20000"))).toBe(20_000);
    } finally {
      console.warn = w;
    }
  });
  it("giá trị lạ ⇒ như vắng (không ném)", async () => {
    for (const v of ["", "abc", "-1", "0", "28672.5"]) expect(await nganSachNguCanhCho(undefined, dep(65_536), env(v))).toBe(65_536);
  });
  it("mặc định đọc process.env (không truyền env)", async () => {
    const cu = process.env.AI_AGENT_NGAN_SACH_EP;
    try {
      process.env.AI_AGENT_NGAN_SACH_EP = "28672";
      expect(await nganSachNguCanhCho(undefined, dep(65_536))).toBe(28_672);
      delete process.env.AI_AGENT_NGAN_SACH_EP;
      expect(await nganSachNguCanhCho(undefined, dep(65_536))).toBe(65_536);
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_NGAN_SACH_EP;
      else process.env.AI_AGENT_NGAN_SACH_EP = cu;
    }
  });
});
