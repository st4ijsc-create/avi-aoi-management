WITH ngay_rieng AS (
  SELECT DISTINCT nguoi_dung, date(luc) AS ngay
  FROM dang_nhap
),
danh_dau AS (
  SELECT nguoi_dung, ngay,
         julianday(ngay) - ROW_NUMBER() OVER (PARTITION BY nguoi_dung ORDER BY ngay) AS nhom
  FROM ngay_rieng
),
chuoi AS (
  SELECT nguoi_dung, COUNT(*) AS do_dai, MIN(ngay) AS bat_dau, MAX(ngay) AS ket_thuc
  FROM danh_dau
  GROUP BY nguoi_dung, nhom
),
xep AS (
  SELECT nguoi_dung, do_dai, bat_dau, ket_thuc,
         ROW_NUMBER() OVER (PARTITION BY nguoi_dung ORDER BY do_dai DESC, bat_dau ASC) AS hang
  FROM chuoi
)
SELECT nguoi_dung, do_dai, bat_dau, ket_thuc
FROM xep
WHERE hang = 1
ORDER BY do_dai DESC, nguoi_dung ASC
