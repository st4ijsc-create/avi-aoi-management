WITH loc AS (
  SELECT d.id,
         d.khach,
         json_extract(d.du_lieu, '$.ngay') AS ngay,
         (SELECT SUM(json_extract(m.value, '$.sl'))
            FROM json_each(d.du_lieu, '$.mat_hang') AS m) AS tong_sl
  FROM don_hang d
  WHERE EXISTS (SELECT 1 FROM json_each(d.du_lieu, '$.mat_hang') AS m
                WHERE json_extract(m.value, '$.gia') >= :nguong)
)
SELECT khach,
       json_group_array(json_object('id', id, 'ngay', ngay, 'tong_sl', tong_sl) ORDER BY id) AS don
FROM loc
GROUP BY khach
ORDER BY khach
