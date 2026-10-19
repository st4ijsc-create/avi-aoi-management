WITH khung AS (
  SELECT g AS khung
  FROM generate_series($1::timestamptz, $2::timestamptz - interval '1 microsecond', interval '15 minutes') AS g
), gan AS (
  SELECT date_bin('15 minutes', luc, $1::timestamptz) AS khung, gia_tri
  FROM do_kiem
  WHERE luc >= $1::timestamptz AND luc < $2::timestamptz
)
SELECT k.khung, count(g.gia_tri) AS so_ban_ghi, round(avg(g.gia_tri), 2) AS tb
FROM khung k
LEFT JOIN gan g ON g.khung = k.khung
GROUP BY k.khung
ORDER BY k.khung;
