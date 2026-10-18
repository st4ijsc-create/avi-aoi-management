CREATE OR REPLACE FUNCTION ghi_dem(p_ma text, p_them integer)
RETURNS TABLE(ma text, so_lan integer, moi boolean)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
  IF p_them IS NULL OR p_them <= 0 THEN
    RAISE EXCEPTION 'p_them phai > 0 (nhan %)', p_them USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    INSERT INTO dem_loi AS d (ma, so_lan) VALUES (p_ma, p_them)
    ON CONFLICT (ma) DO UPDATE SET so_lan = d.so_lan + EXCLUDED.so_lan
    RETURNING d.ma, d.so_lan, (d.xmax = 0);
END;
$$;
