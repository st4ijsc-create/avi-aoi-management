/**
 * B7 — aiSegmentation decode tests. Tensor mask giả (không cần ONNX runtime).
 */
import { describe, it, expect } from "vitest";
import { decodeSegmentation, measureDecodedMasks } from "./aiSegmentation";

describe("decodeSegmentation — semantic argmax [1,C,H,W]", () => {
  it("2 lớp 4×4: lớp 1 chiếm góc trên-trái 2×2 → mask đúng vùng + bbox", () => {
    const H = 4, W = 4, C = 2;
    const HW = H * W;
    const data = new Float32Array(C * HW);
    // channel 0 (background) cao mặc định; channel 1 cao tại 4 pixel góc trên-trái.
    for (let p = 0; p < HW; p++) {
      data[0 * HW + p] = 1; // bg logit
      data[1 * HW + p] = -1; // class1 logit thấp
    }
    const fg = [0, 1, 4, 5]; // (0,0),(1,0),(0,1),(1,1)
    for (const p of fg) {
      data[0 * HW + p] = -1;
      data[1 * HW + p] = 3; // class1 thắng
    }
    const { masks, outputType } = decodeSegmentation(data, [1, C, H, W], {
      labels: ["bg", "scratch"],
    });
    expect(outputType).toBe("semantic-argmax");
    // background (index 0) bị loại; còn 1 mask class1.
    expect(masks.length).toBe(1);
    const mk = masks[0];
    expect(mk.label).toBe("scratch");
    expect(mk.classIndex).toBe(1);
    expect(mk.pixelCount).toBe(4);
    expect(mk.bbox).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(mk.confidence).toBeGreaterThan(0.9); // softmax(3 vs -1) ~ 0.98
  });

  it("accepts [C,H,W] (no batch dim)", () => {
    const H = 2, W = 2, C = 2, HW = 4;
    const data = new Float32Array(C * HW);
    data[1 * HW + 0] = 5; // class1 thắng pixel 0 thôi
    const { masks } = decodeSegmentation(data, [C, H, W]);
    expect(masks.length).toBe(1);
    expect(masks[0].pixelCount).toBe(1);
  });
});

describe("decodeSegmentation — binary sigmoid [1,1,H,W]", () => {
  it("sigmoid + threshold → 1 mask defect tại vùng logit dương", () => {
    const H = 4, W = 4, HW = 16;
    const data = new Float32Array(HW).fill(-5); // sigmoid(-5)~0.0067 < 0.5
    data[5] = 5; data[6] = 5; data[9] = 5; data[10] = 5; // 2×2 giữa
    const { masks, outputType } = decodeSegmentation(data, [1, 1, H, W], {
      labels: ["defect"],
    });
    expect(outputType).toBe("binary-sigmoid");
    expect(masks.length).toBe(1);
    expect(masks[0].label).toBe("defect");
    expect(masks[0].pixelCount).toBe(4);
    expect(masks[0].confidence).toBeGreaterThan(0.9);
  });

  it("không pixel nào vượt threshold → 0 mask (không crash)", () => {
    const data = new Float32Array(16).fill(-10);
    const { masks } = decodeSegmentation(data, [1, 1, 4, 4]);
    expect(masks.length).toBe(0);
  });
});

describe("decodeSegmentation — dims không hợp lệ", () => {
  it("ném lỗi rõ ràng với dims 2-D", () => {
    expect(() => decodeSegmentation(new Float32Array(4), [2, 2])).toThrow(/Unsupported/);
  });
});

describe("measureDecodedMasks", () => {
  it("gắn metrology cho mỗi mask (px khi thiếu calib)", () => {
    const H = 4, W = 4, HW = 16, C = 2;
    const data = new Float32Array(C * HW);
    for (let p = 0; p < HW; p++) { data[0 * HW + p] = 1; data[1 * HW + p] = -1; }
    for (const p of [5, 6, 9, 10]) { data[0 * HW + p] = -1; data[1 * HW + p] = 4; }
    const { masks } = decodeSegmentation(data, [1, C, H, W]);
    const measured = measureDecodedMasks(masks);
    expect(measured.length).toBe(1);
    expect(measured[0].metrology.unit).toBe("px");
    expect(measured[0].metrology.areaPx).toBeGreaterThan(0);
  });
});
