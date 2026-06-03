/**
 * B7 — aiSegmentation decode tests. Tensor mask giả (không cần ONNX runtime).
 */
import { describe, it, expect } from "vitest";
import { decodeSegmentation, measureDecodedMasks, decodeYoloSeg } from "./aiSegmentation";

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

describe("decodeYoloSeg — proto+coeff (YOLOv8-seg)", () => {
  it("1 anchor, nc=1, 1 proto kênh thắng → 1 mask vùng box", () => {
    // det [1, A, N], A = 4 + nc(1) + np(32) = 37, N = 2 anchors.
    const nc = 1, np = 32, A = 4 + nc + np, N = 2;
    const imgSize = 16, mh = 4, mw = 4, protoHW = mh * mw;
    const det = new Float32Array(A * N);
    const get = (a: number, n: number) => a * N + n;
    // anchor 0: box phủ toàn ảnh (cx=8,cy=8,w=16,h=16), score lớp cao, coeff[0]=1.
    det[get(0, 0)] = 8; det[get(1, 0)] = 8; det[get(2, 0)] = 16; det[get(3, 0)] = 16;
    det[get(4, 0)] = 0.9;            // class score
    det[get(4 + nc + 0, 0)] = 4;     // coeff kênh 0 lớn → kích hoạt proto kênh 0
    // anchor 1: score thấp → bị loại.
    det[get(4, 1)] = 0.01;

    // proto [1, 32, mh, mw]: kênh 0 dương ở nửa trên (8 pixel), âm phần còn lại.
    const proto = new Float32Array(np * protoHW);
    for (let p = 0; p < protoHW; p++) {
      proto[0 * protoHW + p] = p < protoHW / 2 ? 5 : -5;
    }
    const { masks, outputType, maskWidth, maskHeight } = decodeYoloSeg(
      det, [1, A, N], proto, [1, np, mh, mw], imgSize,
      { labels: ["scratch"], scoreThreshold: 0.25 },
    );
    expect(outputType).toBe("yolo-seg");
    expect(maskWidth).toBe(mw);
    expect(maskHeight).toBe(mh);
    expect(masks.length).toBe(1);
    expect(masks[0].label).toBe("scratch");
    expect(masks[0].classIndex).toBe(0);
    // sigmoid(4*5)=~1 ở nửa trên → ~8 pixel.
    expect(masks[0].pixelCount).toBe(protoHW / 2);
  });

  it("không anchor nào vượt score → 0 mask", () => {
    const nc = 1, np = 32, A = 4 + nc + np, N = 1, mh = 4, mw = 4;
    const det = new Float32Array(A * N); // tất cả 0
    const proto = new Float32Array(np * mh * mw);
    const { masks } = decodeYoloSeg(det, [1, A, N], proto, [1, np, mh, mw], 16);
    expect(masks.length).toBe(0);
  });

  it("ném lỗi với proto dims sai", () => {
    expect(() =>
      decodeYoloSeg(new Float32Array(37), [1, 37, 1], new Float32Array(4), [1, 32, 4], 16),
    ).toThrow(/Unsupported/);
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
