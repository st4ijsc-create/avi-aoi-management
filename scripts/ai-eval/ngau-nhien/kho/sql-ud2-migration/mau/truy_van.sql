WITH gio AS (
  SELECT nhan_vien_id, SUM(so_gio) AS g
  FROM cham_cong
  GROUP BY nhan_vien_id
)
SELECT n.phong,
       COUNT(*) AS so_nguoi,
       COUNT(n.email) AS so_co_email,
       group_concat(trim(n.ho || ' ' || n.ten), ', ' ORDER BY n.ten, n.ho, n.id) AS danh_sach,
       COALESCE(SUM(gio.g), 0.0) AS tong_gio
FROM nhan_vien n
LEFT JOIN gio ON gio.nhan_vien_id = n.id
GROUP BY n.phong
ORDER BY so_nguoi DESC, n.phong ASC
