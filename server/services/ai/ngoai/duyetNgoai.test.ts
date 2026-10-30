/**
 * ★ Đợt 10.4 (rà client của luong-ui) — `tomTatNgoaiPhienBan`: màn duyệt phải đọc được HẾT lời nhắc (≤ `TRAN_TOM_TAT_LENH`, đã che)
 * VÀ thấy mọi tham chiếu dữ liệu (`$json…`, `$node("…")…`) sẽ được ghép vào lời nhắc — kể cả ở tham số không phải lời nhắc.
 */
import { describe, expect, it } from "vitest";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { TRAN_TOM_TAT_LENH, tomTatNgoaiPhienBan } from "./duyetNgoai";

const phienBan = (parameters: Record<string, unknown>) => ({
  definition: {
    id: "f",
    name: "f",
    version: 1,
    nodes: [
      { id: "t", type: "kich-hoat.thu-cong", position: [0, 0], parameters: {} },
      { id: "ai", type: "ai.llm", position: [1, 0], parameters: { chonModel: "ngoai:anthropic:claude-x", ...parameters } },
    ],
    connections: [],
  } as unknown as FlowDefinition,
  ngoaiDuyetLuc: null,
  ngoaiBamDuyet: null,
  ngoaiDuyetBoi: null,
  ngoaiTuDuyet: false,
  createdBy: 1,
});

async function nutDau(parameters: Record<string, unknown>) {
  const t = await tomTatNgoaiPhienBan(phienBan(parameters), 1, async () => null);
  if (!t.coNodeNgoai) throw new Error("phải có node ngoài");
  return t.nodes[0];
}

describe("tomTatNgoaiPhienBan — tomTatLenh đầy đủ + thamChieu", () => {
  it("lời nhắc dài ⇒ giữ tới TRAN_TOM_TAT_LENH ký tự (không cắt ở 200) — phần cuối biểu thức vẫn đọc được", async () => {
    const loiNhac = "Đánh giá {{ $json.a }} ".padEnd(3000, ".") + "ĐUÔI-QUAN-TRỌNG {{ $node(\"doc\").json.matKhau }}";
    const n = await nutDau({ loiNhac: loiNhac + " z".repeat(1500) });
    expect(TRAN_TOM_TAT_LENH).toBe(4000);
    expect(n.tomTatLenh.length).toBe(TRAN_TOM_TAT_LENH);
    expect(n.tomTatLenh).toContain("ĐUÔI-QUAN-TRỌNG");
  });

  it("thamChieu: lấy từ MỌI tham số chuỗi (cả lồng / mảng), bỏ trùng, không lấy chonModel", async () => {
    const n = await nutDau({
      loiNhac: "Máy {{ $json.may.ten }} lỗi {{ $json['so loi'] }}; {{ $json.may.ten }}",
      heThong: { phu: ["xem {{ $node(\"doc PLC\").items[0].tag }}", 3] },
      them: "{{ $input.items[1].a }} {{ $env.X }} {{ $run.id }} giá $5 và $jsonx",
    });
    expect(n.thamChieu).toEqual([
      "$json.may.ten",
      "$json['so loi']",
      '$node("doc PLC").items[0].tag',
      "$input.items[1].a",
      "$env.X",
      "$run.id",
    ]);
  });

  it("tham chiếu cũng đi qua bộ che (tên node viết bí mật vào)", async () => {
    const n = await nutDau({ loiNhac: "{{ $node(\"password=Hunter2xyz99\").json.a }}" });
    expect(n.thamChieu).toHaveLength(1);
    expect(JSON.stringify(n.thamChieu)).not.toContain("Hunter2xyz99");
  });

  it("không có tham chiếu ⇒ []; bí mật trong lời nhắc bị che ở tomTatLenh", async () => {
    const n = await nutDau({ loiNhac: "kiểm tra; password=Hunter2xyz99 đừng lộ" });
    expect(n.thamChieu).toEqual([]);
    expect(n.tomTatLenh).not.toContain("Hunter2xyz99");
  });
});
