-- Repeatable correction of the existing merge function. Only users referencing
-- the withdrawn event are updated; permissions and provenance behavior remain.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-036'));
DO $$
DECLARE original text; revised text;
BEGIN
  IF to_regprocedure('public.chob_review_duplicates(uuid[],uuid,text)') IS NULL THEN
    RAISE EXCEPTION '036 requires the existing duplicate merge function';
  END IF;
  SELECT pg_get_functiondef('public.chob_review_duplicates(uuid[],uuid,text)'::regprocedure) INTO original;
  IF strpos(original, 'chob-safe-personal-merge') = 0 THEN
    revised := replace(original, 'ELSE tags END;',
      'ELSE tags END
       -- chob-safe-personal-merge
       WHERE (''supabase:''||id_value::text) = ANY(coalesce(favorites, ARRAY[]::text[]))
          OR (''supabase:''||id_value::text) = ANY(coalesce(items, ARRAY[]::text[]))
          OR coalesce(tags, ''{}''::jsonb) ? (''supabase:''||id_value::text);');
    IF revised = original THEN
      RAISE EXCEPTION '036: merge function version mismatch; no changes applied';
    END IF;
    EXECUTE revised;
  END IF;
END $$;
INSERT INTO chob_private.migrations(version) VALUES('036') ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
