/**
 * lichSuThaoTac.unit.test.ts — undo/redo command-pattern (§7.2 #9).
 * ★ Tên tệp `.unit.test.ts` bắt buộc (luật G3).
 */

import { describe, expect, it } from "vitest";
import {
  CUA_SO_GOP_MS,
  GIOI_HAN_STACK,
  type LichSu,
  type MaThaoTac,
  type ThaoTac,
  coTheGop,
  coTheHoanTac,
  coTheLamLai,
  ghiThaoTac,
  gopThaoTac,
  hoanTac,
  lamLai,
  lichSuRong,
  soVatTheDaDoi,
  xoaLichSu,
} from "./lichSuThaoTac";

/** Một lệnh kéo một máy từ x=`tu` sang x=`den`. */
function keo(khoa: string, tu: number, den: number, moc: number): ThaoTac {
  return {
    op: "keo",
    targets: [khoa],
    truoc: { [khoa]: { viTriXMm: tu } },
    sau: { [khoa]: { viTriXMm: den } },
    moc,
  };
}

function lenh(op: MaThaoTac, khoa: string, moc?: number): ThaoTac {
  return {
    op,
    targets: [khoa],
    truoc: { [khoa]: { v: 0 } },
    sau: { [khoa]: { v: 1 } },
    moc,
  };
}

describe("lichSuRong / cờ trạng thái — G8", () => {
  it("lịch sử rỗng: KHÔNG hoàn tác được, KHÔNG làm lại được", () => {
    const ls = lichSuRong();
    expect(coTheHoanTac(ls)).toBe(false);
    expect(coTheLamLai(ls)).toBe(false);
  });

  it("sau một lệnh: hoàn tác ĐƯỢC, làm lại KHÔNG (nhánh redo bị xoá)", () => {
    const ls = ghiThaoTac(lichSuRong(), lenh("xoay", "machine:1", 1000));
    expect(coTheHoanTac(ls)).toBe(true);
    expect(coTheLamLai(ls)).toBe(false);
  });

  it("sau khi hoàn tác: làm lại ĐƯỢC", () => {
    const ls = ghiThaoTac(lichSuRong(), lenh("xoay", "machine:1", 1000));
    const sau = hoanTac(ls).lichSu;
    expect(coTheLamLai(sau)).toBe(true);
    expect(coTheHoanTac(sau)).toBe(false);
  });
});

describe("undo / redo đúng thứ tự", () => {
  it("hoàn tác LIFO — lệnh mới nhất ra trước", () => {
    let ls = lichSuRong();
    ls = ghiThaoTac(ls, lenh("xoay", "a", 1000));
    ls = ghiThaoTac(ls, lenh("coGian", "b", 5000));
    ls = ghiThaoTac(ls, lenh("canh", "c", 9000));

    const b1 = hoanTac(ls);
    expect(b1.thaoTac?.op).toBe("canh");
    const b2 = hoanTac(b1.lichSu);
    expect(b2.thaoTac?.op).toBe("coGian");
    const b3 = hoanTac(b2.lichSu);
    expect(b3.thaoTac?.op).toBe("xoay");
    expect(coTheHoanTac(b3.lichSu)).toBe(false);
  });

  it("làm lại trả đúng thứ tự ngược lại", () => {
    let ls = lichSuRong();
    ls = ghiThaoTac(ls, lenh("xoay", "a", 1000));
    ls = ghiThaoTac(ls, lenh("coGian", "b", 5000));
    ls = hoanTac(hoanTac(ls).lichSu).lichSu;

    const r1 = lamLai(ls);
    expect(r1.thaoTac?.op).toBe("xoay");
    const r2 = lamLai(r1.lichSu);
    expect(r2.thaoTac?.op).toBe("coGian");
    expect(coTheLamLai(r2.lichSu)).toBe(false);
  });

  it("★ undo trả `truoc`, redo trả `sau` — không đảo chiều", () => {
    const ls = ghiThaoTac(lichSuRong(), keo("machine:7", 1000, 5000, 1));
    const u = hoanTac(ls);
    expect(u.canGhi).toEqual({ "machine:7": { viTriXMm: 1000 } });
    const r = lamLai(u.lichSu);
    expect(r.canGhi).toEqual({ "machine:7": { viTriXMm: 5000 } });
  });

  it("undo→redo→undo về đúng trạng thái ban đầu, lặp bao nhiêu lần cũng vậy", () => {
    const ls = ghiThaoTac(lichSuRong(), keo("machine:7", 1000, 5000, 1));
    let cur: LichSu = ls;
    for (let i = 0; i < 5; i++) {
      const u = hoanTac(cur);
      expect(u.canGhi).toEqual({ "machine:7": { viTriXMm: 1000 } });
      const r = lamLai(u.lichSu);
      expect(r.canGhi).toEqual({ "machine:7": { viTriXMm: 5000 } });
      cur = r.lichSu;
    }
  });

  it("stack rỗng: KHÔNG ném lỗi, trả lịch sử nguyên vẹn và thaoTac null", () => {
    const ls = lichSuRong();
    const u = hoanTac(ls);
    expect(u.thaoTac).toBeNull();
    expect(u.canGhi).toBeNull();
    expect(u.lichSu).toBe(ls);
    const r = lamLai(ls);
    expect(r.thaoTac).toBeNull();
    expect(r.lichSu).toBe(ls);
  });

  it("KHÔNG đột biến lịch sử cũ (mọi hàm trả ảnh chụp mới)", () => {
    const ls = ghiThaoTac(lichSuRong(), lenh("xoay", "a", 1));
    const truocDo = ls.undo.length;
    hoanTac(ls);
    ghiThaoTac(ls, lenh("canh", "b", 2));
    expect(ls.undo.length).toBe(truocDo);
    expect(ls.redo.length).toBe(0);
  });
});

describe("redo bị XOÁ sau thao tác mới", () => {
  it("hoàn tác rồi ghi lệnh mới → không còn gì để làm lại", () => {
    let ls = ghiThaoTac(lichSuRong(), lenh("xoay", "a", 1000));
    ls = hoanTac(ls).lichSu;
    expect(coTheLamLai(ls)).toBe(true);
    ls = ghiThaoTac(ls, lenh("canh", "b", 9000));
    expect(coTheLamLai(ls)).toBe(false);
    expect(ls.redo).toEqual([]);
  });

  it("xoá nhánh redo NHIỀU bước, không chỉ bước trên đỉnh", () => {
    let ls = lichSuRong();
    ls = ghiThaoTac(ls, lenh("xoay", "a", 1000));
    ls = ghiThaoTac(ls, lenh("canh", "b", 5000));
    ls = ghiThaoTac(ls, lenh("xoa", "c", 9000));
    ls = hoanTac(hoanTac(hoanTac(ls).lichSu).lichSu).lichSu;
    expect(ls.redo.length).toBe(3);
    ls = ghiThaoTac(ls, lenh("them", "d", 20_000));
    expect(ls.redo.length).toBe(0);
  });
});

describe("giới hạn 50 bước", () => {
  it("stack dừng ở đúng GIOI_HAN_STACK", () => {
    expect(GIOI_HAN_STACK).toBe(50);
    let ls = lichSuRong();
    for (let i = 0; i < 120; i++) {
      // op 'xoay' KHÔNG gộp, và moc cách nhau xa để chắc chắn không gộp.
      ls = ghiThaoTac(ls, lenh("xoay", `machine:${i}`, i * 10_000));
    }
    expect(ls.undo.length).toBe(50);
  });

  it("bỏ phần tử CŨ NHẤT, giữ phần tử MỚI NHẤT", () => {
    let ls = lichSuRong();
    for (let i = 0; i < 60; i++) {
      ls = ghiThaoTac(ls, lenh("xoay", `machine:${i}`, i * 10_000));
    }
    expect(ls.undo[0].targets).toEqual(["machine:10"]);
    expect(ls.undo[49].targets).toEqual(["machine:59"]);
  });

  it("stack redo cũng bị kẹp ở 50", () => {
    let ls = lichSuRong();
    for (let i = 0; i < 50; i++) {
      ls = ghiThaoTac(ls, lenh("xoay", `machine:${i}`, i * 10_000));
    }
    for (let i = 0; i < 50; i++) ls = hoanTac(ls).lichSu;
    expect(ls.redo.length).toBe(50);
    expect(ls.undo.length).toBe(0);
  });
});

describe("gộp thao tác kéo liên tiếp", () => {
  it("coTheGop — TRUE với 2 lệnh keo cùng targets cách nhau 100 ms", () => {
    expect(coTheGop(keo("m:1", 0, 100, 1000), keo("m:1", 100, 200, 1100))).toBe(true);
  });

  it("coTheGop — G8, FALSE với op KHÁC keo", () => {
    expect(coTheGop(lenh("xoay", "m:1", 1000), lenh("xoay", "m:1", 1100))).toBe(false);
  });

  it("coTheGop — G8, FALSE khi targets KHÁC nhau", () => {
    expect(coTheGop(keo("m:1", 0, 100, 1000), keo("m:2", 0, 100, 1100))).toBe(false);
  });

  it("coTheGop — G8, FALSE khi cách nhau quá cửa sổ", () => {
    expect(coTheGop(keo("m:1", 0, 100, 1000), keo("m:1", 100, 200, 1000 + CUA_SO_GOP_MS + 1))).toBe(
      false,
    );
  });

  it("coTheGop — G8, FALSE khi thiếu `moc`", () => {
    const a: ThaoTac = { ...keo("m:1", 0, 100, 1000), moc: undefined };
    const b = keo("m:1", 100, 200, 1100);
    expect(coTheGop(a, b)).toBe(false);
    expect(coTheGop(b, a)).toBe(false);
  });

  it("coTheGop — TRUE với tập targets cùng phần tử nhưng KHÁC thứ tự", () => {
    const a: ThaoTac = { ...keo("m:1", 0, 1, 1000), targets: ["m:1", "m:2"] };
    const b: ThaoTac = { ...keo("m:1", 1, 2, 1100), targets: ["m:2", "m:1"] };
    expect(coTheGop(a, b)).toBe(true);
  });

  it("★ gộp giữ `truoc` của lệnh ĐẦU và `sau` của lệnh CUỐI", () => {
    const g = gopThaoTac(keo("m:1", 1000, 1100, 1), keo("m:1", 1100, 5000, 2));
    expect(g.truoc).toEqual({ "m:1": { viTriXMm: 1000 } });
    expect(g.sau).toEqual({ "m:1": { viTriXMm: 5000 } });
  });

  it("★ 40 sự kiện kéo liên tiếp = MỘT bước undo, và undo về ĐÚNG chỗ xuất phát", () => {
    let ls = lichSuRong();
    let x = 1000;
    for (let i = 0; i < 40; i++) {
      const moi = x + 100;
      ls = ghiThaoTac(ls, keo("machine:7", x, moi, 1000 + i * 10));
      x = moi;
    }
    expect(ls.undo.length).toBe(1);
    const u = hoanTac(ls);
    // Về ĐÚNG 1000, không phải 4900 (chỗ nửa đường của lệnh cuối).
    expect(u.canGhi).toEqual({ "machine:7": { viTriXMm: 1000 } });
    expect(coTheHoanTac(u.lichSu)).toBe(false);
  });

  it("kéo máy A rồi kéo máy B là HAI bước undo", () => {
    let ls = ghiThaoTac(lichSuRong(), keo("machine:1", 0, 100, 1000));
    ls = ghiThaoTac(ls, keo("machine:2", 0, 100, 1050));
    expect(ls.undo.length).toBe(2);
  });

  it("hai lần kéo cách nhau 5 giây là HAI bước undo", () => {
    let ls = ghiThaoTac(lichSuRong(), keo("machine:1", 0, 100, 1000));
    ls = ghiThaoTac(ls, keo("machine:1", 100, 200, 6000));
    expect(ls.undo.length).toBe(2);
  });

  it("lệnh gộp KHÔNG làm stack dài thêm, và xoá nhánh redo", () => {
    let ls = ghiThaoTac(lichSuRong(), keo("m:1", 0, 100, 1000));
    ls = hoanTac(ls).lichSu;
    expect(ls.redo.length).toBe(1);
    ls = lamLai(ls).lichSu;
    ls = ghiThaoTac(ls, keo("m:1", 100, 200, 1100));
    expect(ls.undo.length).toBe(1);
    expect(ls.redo.length).toBe(0);
  });

  it("ba công cụ Line (§10C.4) là MỘT lệnh, không phải chuỗi thao tác", () => {
    const raiTram: ThaoTac = {
      op: "raiTram",
      targets: ["station:1", "station:2", "station:3"],
      truoc: {
        "station:1": { viTriXMm: 0 },
        "station:2": { viTriXMm: 1000 },
        "station:3": { viTriXMm: 9000 },
      },
      sau: {
        "station:1": { viTriXMm: 0 },
        "station:2": { viTriXMm: 2500 },
        "station:3": { viTriXMm: 5000 },
      },
      moc: 1000,
    };
    const ls = ghiThaoTac(lichSuRong(), raiTram);
    expect(ls.undo.length).toBe(1);
    expect(hoanTac(ls).canGhi).toEqual(raiTram.truoc);
  });
});

describe("soVatTheDaDoi — chỉ báo 'N thay đổi chưa lưu' (§7.3)", () => {
  it("đếm theo VẬT THỂ DUY NHẤT, không theo số lệnh", () => {
    let ls = lichSuRong();
    // 3 lệnh xoay rời rạc trên CÙNG một máy (op 'xoay' không gộp).
    ls = ghiThaoTac(ls, lenh("xoay", "machine:7", 1000));
    ls = ghiThaoTac(ls, lenh("xoay", "machine:7", 9000));
    ls = ghiThaoTac(ls, lenh("xoay", "machine:7", 20_000));
    expect(ls.undo.length).toBe(3);
    expect(soVatTheDaDoi(ls)).toBe(1);
  });

  it("cộng dồn qua nhiều vật thể và nhiều lệnh", () => {
    let ls = lichSuRong();
    ls = ghiThaoTac(ls, lenh("xoay", "machine:1", 1000));
    ls = ghiThaoTac(ls, {
      op: "canh",
      targets: ["machine:2", "machine:3"],
      truoc: {},
      sau: {},
      moc: 9000,
    });
    expect(soVatTheDaDoi(ls)).toBe(3);
  });

  it("lịch sử rỗng → 0", () => {
    expect(soVatTheDaDoi(lichSuRong())).toBe(0);
  });
});

describe("xoaLichSu", () => {
  it("xoá sạch cả hai stack", () => {
    let ls = ghiThaoTac(lichSuRong(), lenh("xoay", "a", 1000));
    ls = hoanTac(ls).lichSu;
    const sach = xoaLichSu();
    expect(sach.undo).toEqual([]);
    expect(sach.redo).toEqual([]);
    expect(coTheHoanTac(sach)).toBe(false);
    expect(coTheLamLai(sach)).toBe(false);
  });
});
