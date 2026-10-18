SELECT t.value AS the,
       COUNT(DISTINCT d.id) AS so_don,
       SUM(json_extract(m.value, '$.sl')) AS so_luong
FROM don_hang d
JOIN json_each(d.du_lieu, '$.mat_hang') AS m
JOIN json_each(m.value, '$.the') AS t
GROUP BY t.value
ORDER BY so_don DESC, the ASC
