import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/van-hanh/CanhVanHanh.tsx";
let s = readFileSync(F, "utf8");

// (A) import từ kit lõi — theo đúng khối import sẵn có.
const cuA = `  KhungCanh,`;
if (!s.includes(cuA)) throw new Error("A");
const moiA = `  KhungCanh,
  farTheoBanKinh,
  khoangCachZoomXaNhat,`;
s = s.replace(cuA, moiA);

// (B) maxDistance dùng chung hằng với far.
const cuB = `      khoangCachToiDa: Math.max(80, banKinhToiDa * 8),`;
const moiB = `      // ★ PH-50b — CÙNG một hằng với \`farTheoBanKinh\`: \`far\` được suy TỪ con số này,
      //   nên hai thứ không trôi khỏi nhau được nữa (\`loi/catCanh.ts\`).
      khoangCachToiDa: khoangCachZoomXaNhat(banKinhToiDa),`;
if (!s.includes(cuB)) throw new Error("B");
s = s.replace(cuB, moiB);

// (C) far theo bán kính.
const cuC = `      far={Math.max(2000, banKinh * 24)}`;
const moiC = `      far={farTheoBanKinh(banKinh)}`;
if (!s.includes(cuC)) throw new Error("C");
s = s.replace(cuC, moiC);

writeFileSync(F, s, "utf8");
console.log("ok");
