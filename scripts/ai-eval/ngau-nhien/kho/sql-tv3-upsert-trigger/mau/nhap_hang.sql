INSERT INTO ton_kho (ma, ten, ton)
VALUES (:ma, :ten, :so_luong)
ON CONFLICT (ma) DO UPDATE SET
  ten = excluded.ten,
  ton = ton_kho.ton + excluded.ton
RETURNING ma, ten, ton
