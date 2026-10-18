/**
 * Diff theo dòng dựa trên LCS của HẬU TỐ, đi tham lam từ đầu với quy tắc phá hoà: xoá trước thêm.
 * Bảng L[i][j] = độ dài LCS của cu[i..] và moi[j..], lưu phẳng trong Int32Array (n+1)×(m+1).
 */
export function diffDong(cu, moi) {
  const n = cu.length;
  const m = moi.length;
  const w = m + 1;
  const L = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = cu[i] === moi[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const ra = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && cu[i] === moi[j]) {
      ra.push({ loai: " ", dong: cu[i] });
      i++;
      j++;
    } else if (j === m || (i < n && L[(i + 1) * w + j] >= L[i * w + j + 1])) {
      ra.push({ loai: "-", dong: cu[i] });
      i++;
    } else {
      ra.push({ loai: "+", dong: moi[j] });
      j++;
    }
  }
  return ra;
}

const LOAI = [" ", "-", "+"];

/** Áp thao tác lên `goc`: các loại `khop` phải trùng từng dòng của goc theo thứ tự; loại `them` sinh dòng mới. */
function ap(goc, thaoTac, khop, giu) {
  const ra = [];
  let k = 0;
  for (const t of thaoTac) {
    if (!LOAI.includes(t?.loai)) throw new Error(`loại thao tác lạ: ${t?.loai}`);
    if (khop.includes(t.loai)) {
      if (k >= goc.length || goc[k] !== t.dong) throw new Error(`bản vá không khớp tại dòng ${k + 1}`);
      k++;
    }
    if (giu.includes(t.loai)) ra.push(t.dong);
  }
  if (k !== goc.length) throw new Error("bản vá không phủ hết văn bản gốc");
  return ra;
}

export function apDung(cu, thaoTac) {
  return ap(cu, thaoTac, [" ", "-"], [" ", "+"]);
}

export function apNguoc(moi, thaoTac) {
  return ap(moi, thaoTac, [" ", "+"], [" ", "-"]);
}
