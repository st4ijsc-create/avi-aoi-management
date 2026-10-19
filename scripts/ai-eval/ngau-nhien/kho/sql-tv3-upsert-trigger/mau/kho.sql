CREATE TABLE ton_kho (
  ma TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  ton INTEGER NOT NULL
);

CREATE TABLE nhat_ky (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ma TEXT NOT NULL,
  ton_cu INTEGER,
  ton_moi INTEGER NOT NULL
);

-- Kiểm tồn âm ở AFTER: trigger BEFORE INSERT cũng chạy cho nhánh DO UPDATE của UPSERT (NEW.ton = lượng xuất âm).
CREATE TRIGGER ton_kho_chan_am_them AFTER INSERT ON ton_kho
WHEN NEW.ton < 0
BEGIN
  SELECT RAISE(ABORT, 'ton am');
END;

CREATE TRIGGER ton_kho_chan_am_sua AFTER UPDATE OF ton ON ton_kho
WHEN NEW.ton < 0
BEGIN
  SELECT RAISE(ABORT, 'ton am');
END;

CREATE TRIGGER ton_kho_ghi_them AFTER INSERT ON ton_kho
BEGIN
  INSERT INTO nhat_ky (ma, ton_cu, ton_moi) VALUES (NEW.ma, NULL, NEW.ton);
END;

CREATE TRIGGER ton_kho_ghi_sua AFTER UPDATE OF ton ON ton_kho
WHEN NEW.ton IS NOT OLD.ton
BEGIN
  INSERT INTO nhat_ky (ma, ton_cu, ton_moi) VALUES (NEW.ma, OLD.ton, NEW.ton);
END;
