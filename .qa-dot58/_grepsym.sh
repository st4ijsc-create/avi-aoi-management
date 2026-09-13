cd /d/SOURCES/_twin_wt
for d in .qa-dot58/dist-head1 .qa-dot58/dist-nen3; do
  echo "=== $d (bundle $(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' $d/public/index.html)) ==="
  for s in vien-tin-cay-may mauChuTrenNen hopManHinh ma-may trang-thai-may ngan-trang-thai do-tuoi-may ngan-do-tuoi data-ton-dong nut-thu-trai; do
    n=$(grep -rlF "$s" "$d/public/assets" 2>/dev/null | wc -l)
    echo "   $s : $n tep"
  done
done
