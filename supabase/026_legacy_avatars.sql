BEGIN;
ALTER TABLE public.chob_personal ADD COLUMN IF NOT EXISTS avatar_seed text NOT NULL DEFAULT '';
DO $migration$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.chob_save_personal(jsonb)'::regprocedure) INTO original;
 IF strpos(original,'''avataaars''')=0 THEN
  revised:=replace(original,'(''initials'',''circle'',''square'')','(''initials'',''circle'',''square'',''avataaars'',''adventurer'',''bottts'',''croodles'',''rings'',''thumbs'',''animated'')');
  IF revised=original THEN RAISE EXCEPTION '头像保存接口版本不符，停止变更'; END IF;
  EXECUTE revised;
 END IF;
END $migration$;
INSERT INTO chob_private.migrations(version) VALUES('026') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
