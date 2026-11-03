-- F5 day du (scada-master, dieu phoi cap so 0435) — `socket_pham_vi`: TRIGGER pg_notify khi QUYEN / PHAM VI / PHIEN cua mot nguoi doi,
-- de moi replica (khong phai edge) xoa cache cuc bo va NGAT socket trinh duyet cua nguoi do (ket noi lai = bat tay moi = cong moi).
-- Nguon kiem ke: .superpowers/sdd/2026-10-27-scada-r1b-2b-2a-an-toan-duong-stop/f5-kiem-ke-phan-cong-socket.md §1, §5.2.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0435.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL. Khong drizzle-kit generate/push. Khong sua drizzle/meta/_journal.json.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Thiet ke:
--   • Kenh `socket_pham_vi`. Tai trong CHI chua so id — KHONG BAO GIO token / mat khau / ten:
--       {"u":[id,...]}            — vai tro / isActive / passwordInvalidBefore / xoa nguoi dung; gan nha may / tap doan; dong quyen
--       {"s":<sessionId>,"u":[id]} — mot phien bi thu hoi (isActive true -> false) hoac bi xoa
--       {"all":1}                 — factories.code / corporateCode doi (hiem, chi admin)
--   • NOTIFY chi giao luc COMMIT, bi bo khi ROLLBACK ⇒ khong ngat truoc khi hang nhin thay duoc, khong ngat vi ghi da hoan tac.
--     Postgres gop cac thong bao GIONG HET trong mot giao dich (vong applyRoleToUser ⇒ mot {"u":[N]}).
--   • KHONG ban tren cap nhat moi request (`lastSignedIn`, `lastActivityAt`, loginAttempts …): `UPDATE OF <cot>` + WHEN IS DISTINCT FROM.
--     INSERT vao user_sessions (dang nhap) KHONG ban.
--   • Ham tai trong `socket_pham_vi_payload` THUAN (khong doc bang, khong ghi) ⇒ test bang SELECT trong giao dich hoan tac (avi_app EXECUTE).
--   • Ham trigger nuot moi loi cua chinh no (RAISE WARNING) ⇒ mot loi dung tai trong KHONG BAO GIO chan viec tat tai khoan / thu hoi phien /
--     go quyen. Thong bao mat ⇒ luot quet dinh ky cua bo nhan (5 phut) + quet khi LISTEN phuc hoi la luoi do.
--   • ⚠ Gioi han da biet: hang doi NOTIFY day (8 GB, chi khi mot listener giu giao dich mo rat lau) lam COMMIT cua giao dich co pg_notify loi —
--     chung moi kenh hien co (device_owner_changed, ot stop epoch). Theo doi `pg_notification_queue_usage()`.
--   • Khong doi quyen bang. Ham trigger: khong ai EXECUTE (Postgres chi kiem quyen luc CREATE TRIGGER). search_path ghim (R-10-e).
--
-- ROLLBACK (bang owner):
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_users_upd ON public."users";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_users_del ON public."users";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_sessions_upd ON public."user_sessions";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_sessions_del ON public."user_sessions";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_ufa ON public."user_factory_assignments";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_uca ON public."user_corporate_assignments";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_permissions ON public."permissions";
--   DROP TRIGGER IF EXISTS trg_socket_pham_vi_factories ON public."factories";
--   DROP FUNCTION IF EXISTS public.socket_pham_vi_notify();
--   DROP FUNCTION IF EXISTS public.socket_pham_vi_payload(text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.socket_pham_vi_payload(p_table text, p_op text, p_old jsonb, p_new jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ids int[];
BEGIN
  IF p_table = 'users' THEN
    IF p_op = 'DELETE' THEN
      RETURN jsonb_build_object('u', jsonb_build_array((p_old->>'id')::int))::text;
    ELSIF p_op = 'UPDATE' AND (
         (p_old->'role') IS DISTINCT FROM (p_new->'role')
      OR (p_old->'isActive') IS DISTINCT FROM (p_new->'isActive')
      OR (p_old->'passwordInvalidBefore') IS DISTINCT FROM (p_new->'passwordInvalidBefore')) THEN
      RETURN jsonb_build_object('u', jsonb_build_array((p_new->>'id')::int))::text;
    END IF;
    RETURN NULL;

  ELSIF p_table = 'user_sessions' THEN
    IF p_op = 'DELETE' THEN
      RETURN jsonb_build_object('s', (p_old->>'id')::int, 'u', jsonb_build_array((p_old->>'userId')::int))::text;
    ELSIF p_op = 'UPDATE' AND (p_old->>'isActive')::boolean IS TRUE AND (p_new->>'isActive')::boolean IS NOT TRUE THEN
      RETURN jsonb_build_object('s', (p_new->>'id')::int, 'u', jsonb_build_array((p_new->>'userId')::int))::text;
    END IF;
    RETURN NULL;

  ELSIF p_table IN ('user_factory_assignments', 'user_corporate_assignments', 'permissions') THEN
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
      FROM unnest(ARRAY[(p_old->>'userId')::int, (p_new->>'userId')::int]) AS t(x)
     WHERE x IS NOT NULL;
    IF v_ids IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('u', to_jsonb(v_ids))::text;

  ELSIF p_table = 'factories' THEN
    IF p_op = 'UPDATE' AND (
         (p_old->'code') IS DISTINCT FROM (p_new->'code')
      OR (p_old->'corporateCode') IS DISTINCT FROM (p_new->'corporateCode')) THEN
      RETURN '{"all":1}';
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.socket_pham_vi_payload(text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socket_pham_vi_payload(text, text, jsonb, jsonb) TO avi_app;

CREATE OR REPLACE FUNCTION public.socket_pham_vi_notify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_payload text;
BEGIN
  BEGIN
    v_payload := public.socket_pham_vi_payload(
      TG_TABLE_NAME,
      TG_OP,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END);
    IF v_payload IS NOT NULL THEN
      PERFORM pg_notify('socket_pham_vi', v_payload);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'socket_pham_vi_notify: % on %.% (%): %', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.socket_pham_vi_notify() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_socket_pham_vi_users_upd ON public."users";
CREATE TRIGGER trg_socket_pham_vi_users_upd
  AFTER UPDATE OF role, "isActive", "passwordInvalidBefore" ON public."users"
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role
     OR OLD."isActive" IS DISTINCT FROM NEW."isActive"
     OR OLD."passwordInvalidBefore" IS DISTINCT FROM NEW."passwordInvalidBefore")
  EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_users_del ON public."users";
CREATE TRIGGER trg_socket_pham_vi_users_del
  AFTER DELETE ON public."users"
  FOR EACH ROW EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_sessions_upd ON public."user_sessions";
CREATE TRIGGER trg_socket_pham_vi_sessions_upd
  AFTER UPDATE OF "isActive" ON public."user_sessions"
  FOR EACH ROW
  WHEN (OLD."isActive" AND NOT NEW."isActive")
  EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_sessions_del ON public."user_sessions";
CREATE TRIGGER trg_socket_pham_vi_sessions_del
  AFTER DELETE ON public."user_sessions"
  FOR EACH ROW EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_ufa ON public."user_factory_assignments";
CREATE TRIGGER trg_socket_pham_vi_ufa
  AFTER INSERT OR UPDATE OR DELETE ON public."user_factory_assignments"
  FOR EACH ROW EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_uca ON public."user_corporate_assignments";
CREATE TRIGGER trg_socket_pham_vi_uca
  AFTER INSERT OR UPDATE OR DELETE ON public."user_corporate_assignments"
  FOR EACH ROW EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_permissions ON public."permissions";
CREATE TRIGGER trg_socket_pham_vi_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public."permissions"
  FOR EACH ROW EXECUTE FUNCTION public.socket_pham_vi_notify();

DROP TRIGGER IF EXISTS trg_socket_pham_vi_factories ON public."factories";
CREATE TRIGGER trg_socket_pham_vi_factories
  AFTER UPDATE OF code, "corporateCode" ON public."factories"
  FOR EACH ROW
  WHEN (OLD.code IS DISTINCT FROM NEW.code OR OLD."corporateCode" IS DISTINCT FROM NEW."corporateCode")
  EXECUTE FUNCTION public.socket_pham_vi_notify();
