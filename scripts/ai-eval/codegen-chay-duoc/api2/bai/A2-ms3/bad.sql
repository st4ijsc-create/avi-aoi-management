-- SAI (lỗi điển hình): chỉ nhóm bản ghi có thật ⇒ khung trống biến mất.
SELECT CAST(DATE_BUCKET(MINUTE, 15, Luc, @Tu) AS datetime2(0)) AS Khung,
       COUNT(*) AS SoBanGhi,
       CAST(ROUND(AVG(GiaTri), 2) AS decimal(9,2)) AS TrungBinh
FROM dbo.DoKiem
WHERE Luc >= @Tu AND Luc < @Den
GROUP BY DATE_BUCKET(MINUTE, 15, Luc, @Tu)
ORDER BY Khung;
