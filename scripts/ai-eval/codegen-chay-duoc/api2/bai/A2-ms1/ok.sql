WITH khac AS (
  SELECT DISTINCT May, MaLoi FROM dbo.Loi
), ds AS (
  SELECT May, STRING_AGG(MaLoi, N', ') WITHIN GROUP (ORDER BY MaLoi) AS DanhSachMa
  FROM khac
  GROUP BY May
)
SELECT l.May, COUNT(*) AS SoLoi, ds.DanhSachMa, MAX(l.Luc) AS LanCuoi
FROM dbo.Loi AS l
JOIN ds ON ds.May = l.May
GROUP BY l.May, ds.DanhSachMa
ORDER BY l.May;
