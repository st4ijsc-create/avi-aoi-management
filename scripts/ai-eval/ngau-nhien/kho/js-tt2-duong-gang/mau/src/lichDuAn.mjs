/** Lập lịch CPM: sớm nhất / muộn nhất / dự trữ / đường găng. Không đệ quy (chuỗi dài 20.000 tác vụ). */
export function lapLich(tacVu) {
  const theoMa = new Map();
  for (const t of tacVu) {
    if (theoMa.has(t.ma)) throw new Error(`trùng mã: ${t.ma}`);
    theoMa.set(t.ma, t);
  }
  for (const t of tacVu) {
    if (!Number.isInteger(t.thoiLuong) || t.thoiLuong < 0) throw new RangeError(`thời lượng không hợp lệ: ${t.ma}`);
  }
  const truocCua = (t) => t.truoc ?? [];
  for (const t of tacVu) {
    for (const p of truocCua(t)) if (!theoMa.has(p)) throw new Error(`phụ thuộc lạ: ${t.ma} cần ${p}`);
  }

  // Kahn theo thứ tự đầu vào
  const conLai = new Map(tacVu.map((t) => [t.ma, new Set(truocCua(t)).size]));
  const sau = new Map(tacVu.map((t) => [t.ma, []]));
  for (const t of tacVu) for (const p of new Set(truocCua(t))) sau.get(p).push(t.ma);
  const thuTu = [];
  const hang = tacVu.filter((t) => conLai.get(t.ma) === 0).map((t) => t.ma);
  for (let k = 0; k < hang.length; k++) {
    const ma = hang[k];
    thuTu.push(ma);
    for (const s of sau.get(ma)) {
      conLai.set(s, conLai.get(s) - 1);
      if (conLai.get(s) === 0) hang.push(s);
    }
  }
  if (thuTu.length < tacVu.length) {
    const R = new Set(tacVu.filter((t) => conLai.get(t.ma) > 0).map((t) => t.ma));
    const viTri = new Map();
    const duong = [];
    let ma = tacVu.find((t) => R.has(t.ma)).ma;
    while (!viTri.has(ma)) {
      viTri.set(ma, duong.length);
      duong.push(ma);
      ma = truocCua(theoMa.get(ma)).find((p) => R.has(p));
    }
    const vong = duong.slice(viTri.get(ma));
    const thuTuVao = new Map(tacVu.map((t, i) => [t.ma, i]));
    let k0 = 0;
    for (let k = 1; k < vong.length; k++) if (thuTuVao.get(vong[k]) < thuTuVao.get(vong[k0])) k0 = k;
    const chuTrinh = [...vong.slice(k0), ...vong.slice(0, k0)];
    const loi = new Error(`chu trình: ${[...chuTrinh, chuTrinh[0]].join(" -> ")}`);
    loi.chuTrinh = chuTrinh;
    throw loi;
  }

  const lich = {};
  for (const ma of thuTu) {
    const t = theoMa.get(ma);
    let bd = 0;
    for (const p of truocCua(t)) bd = Math.max(bd, lich[p].ketThuc);
    lich[ma] = { batDau: bd, ketThuc: bd + t.thoiLuong, batDauMuon: 0, ketThucMuon: 0, duTru: 0 };
  }
  let tong = 0;
  for (const ma of thuTu) tong = Math.max(tong, lich[ma].ketThuc);
  for (let k = thuTu.length - 1; k >= 0; k--) {
    const ma = thuTu[k];
    const x = lich[ma];
    let kt = tong;
    for (const s of sau.get(ma)) kt = Math.min(kt, lich[s].batDauMuon);
    x.ketThucMuon = kt;
    x.batDauMuon = kt - theoMa.get(ma).thoiLuong;
    x.duTru = x.batDauMuon - x.batDau;
  }

  const duongGang = [];
  const dau = tacVu.find((t) => truocCua(t).length === 0 && lich[t.ma].duTru === 0);
  if (dau) {
    let ma = dau.ma;
    for (;;) {
      duongGang.push(ma);
      const ef = lich[ma].ketThuc;
      const ke = sau.get(ma).find((s) => lich[s].duTru === 0 && lich[s].batDau === ef);
      if (ke === undefined) break;
      ma = ke;
    }
  }
  return { tongThoiGian: tong, lich, duongGang };
}
