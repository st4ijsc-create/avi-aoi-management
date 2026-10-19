/**
 * CHỌN NGẪU NHIÊN có hạt giống, PHÂN TẦNG theo ngôn ngữ × mức.
 *
 *   • Cùng `seed` + cùng kho + cùng `n` ⇒ cùng tập bài (tất định; PRNG mulberry32, hạt từ xmur3 của chuỗi seed).
 *   • Chia đều `n` cho các ngôn ngữ (thứ tự ngôn ngữ cũng xáo theo seed ⇒ phần dư không luôn rơi vào cùng ngôn ngữ);
 *     trong một ngôn ngữ, lấy luân phiên qua các mức (thuat-toan / thu-vien / ung-dung) đã xáo.
 *   • Ngôn ngữ thiếu bài so với hạn ngạch ⇒ phần thiếu chuyển cho ngôn ngữ còn bài.
 * Không có `seed` ⇒ người gọi tự sinh (thời gian) và PHẢI ghi vào báo cáo — một con số không có seed không tái lập được.
 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function taoRng(seed) {
  return mulberry32(xmur3(String(seed))());
}
export function xao(mang, rng) {
  const a = [...mang];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {object[]} ds   danh sách bài (có `id`, `lang`, `muc`)
 * @param {{seed:string|number, n:number}} y
 * @returns {object[]} bài được chọn, sắp theo id (thứ tự chạy không phụ thuộc thứ tự rút)
 */
export function chonPhanTang(ds, { seed, n }) {
  const rng = taoRng(seed);
  const sapId = (a) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
  const theoLang = new Map();
  for (const b of sapId(ds)) {
    if (!theoLang.has(b.lang)) theoLang.set(b.lang, new Map());
    const m = theoLang.get(b.lang);
    if (!m.has(b.muc)) m.set(b.muc, []);
    m.get(b.muc).push(b);
  }
  const langs = xao([...theoLang.keys()].sort(), rng);
  // Hàng đợi rút của từng ngôn ngữ: luân phiên các mức đã xáo, mỗi mức đã xáo bài.
  const hangDoi = new Map();
  for (const l of langs) {
    const mucs = xao([...theoLang.get(l).keys()].sort(), rng).map((m) => xao(theoLang.get(l).get(m), rng));
    const q = [];
    for (let i = 0; mucs.some((x) => i < x.length); i++) for (const x of mucs) if (i < x.length) q.push(x[i]);
    hangDoi.set(l, q);
  }
  const tong = Math.min(n, ds.length);
  const chon = [];
  const han = new Map(langs.map((l, i) => [l, Math.floor(tong / langs.length) + (i < tong % langs.length ? 1 : 0)]));
  // Lấy theo hạn ngạch; phần không lấp được chuyển vòng cho ngôn ngữ còn bài.
  let conLai = tong;
  while (conLai > 0) {
    let lay = 0;
    for (const l of langs) {
      const q = hangDoi.get(l);
      while (han.get(l) > 0 && q.length && conLai > 0) {
        chon.push(q.shift());
        han.set(l, han.get(l) - 1);
        conLai--;
        lay++;
      }
    }
    if (conLai === 0 || lay === 0 && langs.every((l) => hangDoi.get(l).length === 0)) break;
    // phân phối lại phần dư cho ngôn ngữ còn bài (theo thứ tự đã xáo)
    const conBai = langs.filter((l) => hangDoi.get(l).length > 0);
    if (!conBai.length) break;
    for (let i = 0; i < conLai; i++) han.set(conBai[i % conBai.length], han.get(conBai[i % conBai.length]) + 1);
  }
  return sapId(chon);
}
