-- SAI (lỗi điển hình): chỉ nhóm bản ghi có thật ⇒ khung trống biến mất.
SELECT date_bin('15 minutes', luc, $1::timestamptz) AS khung, count(*) AS so_ban_ghi, round(avg(gia_tri), 2) AS tb
FROM do_kiem
WHERE luc >= $1::timestamptz AND luc < $2::timestamptz
GROUP BY 1
ORDER BY 1;
