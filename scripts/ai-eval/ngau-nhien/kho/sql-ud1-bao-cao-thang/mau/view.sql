CREATE VIEW ban_hang_chuan AS
SELECT id,
       strftime('%Y-%m', luc) AS thang,
       khu_vuc,
       so_tien - COALESCE(giam_gia, 0) AS thuc_thu
FROM ban_hang;
