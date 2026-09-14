cd /d/SOURCES/_twin_wt
for d in .qa-dot58/dist-head1 .qa-dot58/dist-nen3; do
  echo "=== $d ==="
  echo -n "   regex mauChuTrenNen : "; grep -rlF '[\s,]+([\d.]+)[\s,]+([\d.]+)' "$d/public/assets" 2>/dev/null | wc -l
  echo -n "   0.2126 (WCAG luma)  : "; grep -rlF '0.2126' "$d/public/assets" 2>/dev/null | wc -l
  echo -n "   flex-[7]            : "; grep -rlF 'flex-[7]' "$d/public/assets" 2>/dev/null | wc -l
  echo -n "   che-nhan gan nut-thu: "; grep -rloE 'nut-thu-trai.{0,120}' "$d/public/assets" 2>/dev/null | head -1 | wc -l
done
echo "--- ngu canh nut-thu-trai tren HEAD ---"
grep -rhoE '.{80}nut-thu-trai.{160}' .qa-dot58/dist-head1/public/assets | head -2
echo "--- ngu canh nut-thu-trai tren NEN ---"
grep -rhoE '.{80}nut-thu-trai.{160}' .qa-dot58/dist-nen3/public/assets | head -2
