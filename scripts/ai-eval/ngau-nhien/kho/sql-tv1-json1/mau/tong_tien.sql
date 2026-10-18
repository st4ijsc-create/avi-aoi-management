SELECT d.id,
       d.khach,
       json_array_length(d.du_lieu, '$.mat_hang') AS so_mat_hang,
       COALESCE((SELECT SUM(json_extract(m.value, '$.sl') * json_extract(m.value, '$.gia'))
                 FROM json_each(d.du_lieu, '$.mat_hang') AS m), 0)
         + COALESCE(json_extract(d.du_lieu, '$.phi_ship'), 0) AS tong_tien
FROM don_hang d
ORDER BY d.id
