// client/src/components/twin3d/van-hanh/datNhanSaBan.ts
var KHE_NHAN_PX = 6;
var TRUOT_TOI_DA_PX = 40;
var chePhu = (vungCam, x, y) => vungCam.find((z) => x >= z.trai && x <= z.phai && y >= z.tren && y <= z.duoi) ?? null;
function giaoLopPhu(vungCam, x, y, co) {
  const trai = x - co.rong / 2;
  const phai = x + co.rong / 2;
  const tren = y - co.cao / 2;
  const duoi = y + co.cao / 2;
  return vungCam.find((z) => z.trai < phai && z.phai > trai && z.tren < duoi && z.duoi > tren) ?? null;
}
function danhSachUngVien(hop, co, uuTien) {
  const giuaX = (hop.trai + hop.phai) / 2;
  const giuaY = (hop.tren + hop.duoi) / 2;
  const nuaCao = co.cao / 2;
  const nuaRong = co.rong / 2;
  const yTren = hop.tren - KHE_NHAN_PX - nuaCao;
  const yDuoi = hop.duoi + KHE_NHAN_PX + nuaCao;
  const oTren = ["tren-giua", giuaX, yTren];
  const oDuoi = ["duoi-giua", giuaX, yDuoi];
  const oTrong = ["trong-giua", giuaX, giuaY];
  const dau = uuTien === "tren" ? [oTren, oDuoi] : uuTien === "duoi" ? [oDuoi, oTren] : [oTrong, oTren, oDuoi];
  return {
    dau,
    phu: [
      ["trong-duoi", giuaX, hop.duoi - KHE_NHAN_PX - nuaCao],
      ["trong-tren", giuaX, hop.tren + KHE_NHAN_PX + nuaCao],
      ["tren-phai", hop.phai - nuaRong, yTren],
      ["tren-trai", hop.trai + nuaRong, yTren],
      ["duoi-phai", hop.phai - nuaRong, yDuoi],
      ["duoi-trai", hop.trai + nuaRong, yDuoi]
    ]
  };
}
function datNhanSaBan(hop, co, vungCam, khung, uuTien) {
  const { dau, phu } = danhSachUngVien(hop, co, uuTien);
  const [maDau, xDau, yDau] = dau[0];
  if (!(khung.rong > 0) || !(khung.cao > 0)) return { x: xDau, y: yDau, ma: maDau };
  const trongKhung = (x, y) => x >= 0 && x <= khung.rong && y >= 0 && y <= khung.cao;
  const hopTrongKhung = (x, y) => x - co.rong / 2 >= 0 && x + co.rong / 2 <= khung.rong && y - co.cao / 2 >= 0 && y + co.cao / 2 <= khung.cao;
  const ungVien = [];
  for (const uv of dau) {
    ungVien.push(uv);
    const [, x, y] = uv;
    const them = [];
    const themTruot = (z) => {
      if (!z) return;
      for (const yy of [z.duoi + KHE_NHAN_PX + co.cao / 2, z.tren - KHE_NHAN_PX - co.cao / 2])
        if (Math.abs(yy - y) <= TRUOT_TOI_DA_PX) them.push(["truot", x, yy]);
    };
    const chanHop = giaoLopPhu(vungCam, x, y, co);
    themTruot(chanHop);
    const chanTam = chePhu(vungCam, x, y);
    if (chanTam && chanTam !== chanHop) themTruot(chanTam);
    ungVien.push(...them);
  }
  ungVien.push(...phu);
  for (const [ma, x, y] of ungVien) {
    if (!hopTrongKhung(x, y)) continue;
    if (giaoLopPhu(vungCam, x, y, co)) continue;
    return { x, y, ma };
  }
  for (const [ma, x, y] of ungVien) {
    if (!trongKhung(x, y)) continue;
    if (chePhu(vungCam, x, y)) continue;
    return { x, y, ma };
  }
  return null;
}
export {
  KHE_NHAN_PX,
  TRUOT_TOI_DA_PX,
  datNhanSaBan
};
