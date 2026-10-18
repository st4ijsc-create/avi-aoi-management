/**
 * Tách argv thành tham số vị trí và cờ.
 *   --ten gia_tri  ⇒ co.ten = "gia_tri"
 *   --ten          ⇒ co.ten = true   (chỉ khi "ten" nằm trong coBoolean)
 */
export function tachThamSo(argv, coBoolean = []) {
  const viTri = [];
  const co = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const ten = a.slice(2);
      if (coBoolean.includes(ten)) {
        co[ten] = true;
      } else {
        const gt = argv[i + 1];
        if (gt === undefined || gt.startsWith("--")) throw new Error(`Cờ --${ten} cần một giá trị`);
        co[ten] = gt;
        i++;
      }
    } else {
      viTri.push(a);
    }
  }
  return { viTri, co };
}
