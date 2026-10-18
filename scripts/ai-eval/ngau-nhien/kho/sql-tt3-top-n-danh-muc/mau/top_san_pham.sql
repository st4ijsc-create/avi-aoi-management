WITH dt AS (
  SELECT s.id, s.ten, s.danh_muc_id, SUM(b.so_luong * b.don_gia) AS doanh_thu
  FROM san_pham s
  JOIN ban_hang b ON b.san_pham_id = s.id
  GROUP BY s.id, s.ten, s.danh_muc_id
),
xep AS (
  SELECT id, ten, danh_muc_id, doanh_thu,
         DENSE_RANK() OVER (PARTITION BY danh_muc_id ORDER BY doanh_thu DESC) AS hang,
         SUM(doanh_thu) OVER (PARTITION BY danh_muc_id) AS tong
  FROM dt
)
SELECT d.ten AS danh_muc,
       x.hang,
       x.ten AS san_pham,
       COALESCE(x.doanh_thu, 0) AS doanh_thu,
       round(100.0 * x.doanh_thu / x.tong, 2) AS ty_trong
FROM danh_muc d
LEFT JOIN xep x ON x.danh_muc_id = d.id AND x.hang <= 2
ORDER BY d.id, x.hang, x.ten, x.id
