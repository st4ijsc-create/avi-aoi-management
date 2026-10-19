WITH cuoi AS (
  SELECT DISTINCT ON (may) may, gia_tri AS gia_tri_cuoi
  FROM do_kiem
  ORDER BY may, luc DESC, id DESC
), dem AS (
  SELECT may,
         count(*) FILTER (WHERE ket_qua = 'NG') AS so_ng,
         count(*) AS tong
  FROM do_kiem
  GROUP BY may
)
SELECT d.may, c.gia_tri_cuoi, d.so_ng, round(d.so_ng::numeric / d.tong, 4) AS ty_le_ng
FROM dem d JOIN cuoi c USING (may)
ORDER BY d.may;
