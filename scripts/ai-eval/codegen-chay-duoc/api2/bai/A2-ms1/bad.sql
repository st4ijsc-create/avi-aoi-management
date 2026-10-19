-- SAI (lỗi điển hình): STRING_AGG trên mọi dòng ⇒ mã lặp lại ("E01, E02, E10, E10").
SELECT May,
       COUNT(*) AS SoLoi,
       STRING_AGG(MaLoi, N', ') WITHIN GROUP (ORDER BY MaLoi) AS DanhSachMa,
       MAX(Luc) AS LanCuoi
FROM dbo.Loi
GROUP BY May
ORDER BY May;
