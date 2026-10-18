WITH khung AS (
  SELECT DATEADD(MINUTE, 15 * CAST(g.value AS int), @Tu) AS Khung
  FROM GENERATE_SERIES(0, DATEDIFF(MINUTE, @Tu, @Den) / 15 - CASE WHEN DATEDIFF(SECOND, @Tu, @Den) % 900 = 0 THEN 1 ELSE 0 END) AS g
), gan AS (
  SELECT DATE_BUCKET(MINUTE, 15, Luc, @Tu) AS Khung, GiaTri
  FROM dbo.DoKiem
  WHERE Luc >= @Tu AND Luc < @Den
)
SELECT CAST(k.Khung AS datetime2(0)) AS Khung,
       COUNT(g.GiaTri) AS SoBanGhi,
       CAST(ROUND(AVG(g.GiaTri), 2) AS decimal(9,2)) AS TrungBinh
FROM khung AS k
LEFT JOIN gan AS g ON g.Khung = k.Khung
GROUP BY k.Khung
ORDER BY k.Khung;
