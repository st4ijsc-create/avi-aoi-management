WITH RECURSIVE cay(id, ten, cap, duong_dan, khoa) AS (
  SELECT id, ten, 0, ten, printf('%08d', id)
  FROM nhan_vien
  WHERE quan_ly_id IS NULL
  UNION ALL
  SELECT n.id, n.ten, c.cap + 1, c.duong_dan || ' > ' || n.ten,
         c.khoa || '/' || printf('%08d', n.id)
  FROM nhan_vien n
  JOIN cay c ON n.quan_ly_id = c.id
)
SELECT c.id, c.ten, c.cap, c.duong_dan,
       (SELECT COUNT(*) FROM cay d
         WHERE substr(d.khoa, 1, length(c.khoa) + 1) = c.khoa || '/') AS so_cap_duoi
FROM cay c
ORDER BY c.khoa
