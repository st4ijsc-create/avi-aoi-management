// Đợt 12 / H2 vòng 2 (theo kiem-dinh): ký tự UTF-8 nhiều byte bị cắt ở biên chunk (stdout VÀ stderr, độc lập), và `lenh.env` đặt SAU lọc.
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import type { LenhDaDuyet } from "../loi/lenhChoPhep";
import { chayLenhCucBo } from "./chayLenhCucBo";

const lenhNode = (script: string, env?: Record<string, string>): LenhDaDuyet =>
  ({ ten: "node-test", argv: [process.execPath, "-e", script], hienThi: "node -e …", ...(env ? { env } : {}) }) as unknown as LenhDaDuyet;

// Ký tự "€" = E2 82 AC (3 byte). Ghi hai byte đầu, đợi, ghi byte cuối ⇒ hai chunk riêng biệt cắt GIỮA ký tự.
const CAT_GIUA = (luong: "stdout" | "stderr", tien: string) =>
  `const w=process.${luong};w.write(${JSON.stringify(tien)});w.write(Buffer.from([0xE2,0x82]));setTimeout(()=>{w.write(Buffer.from([0xAC]));w.write(${JSON.stringify("|het")});},150)`;

describe("chayLenhCucBo — UTF-8 bị cắt ở biên chunk (thật)", () => {
  it("★ stdout: ký tự 3 byte chia hai chunk vẫn nguyên, không sinh U+FFFD", async () => {
    const kq = await chayLenhCucBo({ lenh: lenhNode(CAT_GIUA("stdout", "gia:")), cwd: tmpdir(), tranMs: 20_000 });
    expect(kq.output).toBe("gia:€|het");
    expect(kq.output.includes("�")).toBe(false);
  }, 30_000);

  it("★ stderr: như trên, bộ giải mã stderr ĐỘC LẬP với stdout", async () => {
    const kq = await chayLenhCucBo({ lenh: lenhNode(CAT_GIUA("stderr", "loi:")), cwd: tmpdir(), tranMs: 20_000 });
    expect(kq.output).toBe("loi:€|het");
  }, 30_000);

  it("★ hai luồng xen kẽ, mỗi luồng cắt giữa ký tự ở lúc khác nhau ⇒ cả hai nguyên vẹn (không dùng chung một bộ giải mã)", async () => {
    const script =
      'const o=process.stdout,e=process.stderr;o.write(Buffer.from([0xE2,0x82]));e.write(Buffer.from([0xE2,0x82]));' +
      'setTimeout(()=>{o.write(Buffer.from([0xAC]));},100);setTimeout(()=>{e.write(Buffer.from([0xAC]));},250);';
    const kq = await chayLenhCucBo({ lenh: lenhNode(script), cwd: tmpdir(), tranMs: 20_000 });
    expect(kq.output).toBe("€€");
  }, 30_000);
});

describe("chayLenhCucBo — `lenh.env` đặt SAU lọc (thật)", () => {
  it("★ biến trong `lenh.env` có tên chứa mảnh cấm (…_TOKEN) VẪN tới tiến trình (hằng của allowlist, không phải bí mật của dev)", async () => {
    const kq = await chayLenhCucBo({
      lenh: lenhNode("console.log(process.env.GOPROXY_TOKEN_THU||'khong-co')", { GOPROXY_TOKEN_THU: "gia-tri-hang" }),
      cwd: tmpdir(),
      tranMs: 20_000,
    });
    expect(kq.output.trim()).toBe("gia-tri-hang");
  }, 30_000);
});
