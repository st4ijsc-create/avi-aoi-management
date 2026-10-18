WITH RECURSIVE cac_thang(t) AS (
  SELECT :tu WHERE :tu <= :den
  UNION ALL
  SELECT strftime('%Y-%m', t || '-01', '+1 month') FROM cac_thang WHERE t < :den
),
tong AS (
  SELECT th.t AS thang,
         k.ma AS khu_vuc,
         COALESCE(SUM(b.thuc_thu), 0) AS doanh_thu,
         COUNT(b.id) AS so_don
  FROM cac_thang th
  CROSS JOIN khu_vuc k
  LEFT JOIN ban_hang_chuan b ON b.thang = th.t AND b.khu_vuc = k.ma
  GROUP BY th.t, k.ma
)
SELECT thang,
       khu_vuc,
       doanh_thu,
       so_don,
       round(100.0 * (doanh_thu - LAG(doanh_thu) OVER w) / NULLIF(LAG(doanh_thu) OVER w, 0), 2) AS tang_truong
FROM tong
WINDOW w AS (PARTITION BY khu_vuc ORDER BY thang)
ORDER BY thang, khu_vuc
