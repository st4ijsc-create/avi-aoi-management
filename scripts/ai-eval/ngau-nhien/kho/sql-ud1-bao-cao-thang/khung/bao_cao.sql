-- TODO: một câu SELECT dùng tham số :tu, :den, đọc từ view ban_hang_chuan
SELECT NULL AS thang, NULL AS khu_vuc, NULL AS doanh_thu, NULL AS so_don, NULL AS tang_truong
WHERE :tu IS NULL AND :den IS NULL AND 0
