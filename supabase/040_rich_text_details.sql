-- Public event descriptions remain plain text for compatibility. The matching
-- AST is projected separately; clients validate its schema and text before use.
-- Keep the existing feed identity, privileges and visibility rules intact.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-040-rich-text-details'));

DO $migration$
DECLARE
 target oid := to_regprocedure('public.chob_public_feed()');
 original text;
 revised text;
 previous_acl aclitem[];
 anchor text := '''field_states'',e.field_states';
 marker text := 'chob-rich-text-details-v1';
 projection text := '/* chob-rich-text-details-v1 */ ''rich_text'',CASE WHEN r.value->>''kind''=''event'' THEN e.attributes->''rich_text'' ELSE NULL END,';
BEGIN
 IF target IS NULL THEN
  RAISE EXCEPTION '040_rich_text_details: public feed is missing; migration rolled back';
 END IF;
 SELECT pg_get_functiondef(target),proacl INTO original,previous_acl FROM pg_proc WHERE oid=target;
 IF strpos(original,'base:=public.chob_public_feed_legacy034();')=0
  OR strpos(original,'jsonb_array_elements(base->''records'') r(value)')=0
  OR strpos(original,'LEFT JOIN public.events e ON')=0
  OR (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION '040_rich_text_details: unknown public feed definition; migration rolled back';
 END IF;

 IF strpos(original,marker)=0 THEN
  IF strpos(original,'''rich_text''')<>0 THEN
   RAISE EXCEPTION '040_rich_text_details: unexpected existing rich-text projection; migration rolled back';
  END IF;
  revised:=replace(original,anchor,projection||anchor);
  EXECUTE revised;
 ELSIF (length(original)-length(replace(original,marker,'')))/length(marker)<>1
  OR strpos(original,projection||anchor)=0 THEN
  RAISE EXCEPTION '040_rich_text_details: changed rich-text projection; migration rolled back';
 END IF;

 IF to_regprocedure('public.chob_public_feed()')::oid IS DISTINCT FROM target
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM previous_acl THEN
  RAISE EXCEPTION '040_rich_text_details: feed identity or permissions changed; migration rolled back';
 END IF;
END $migration$;

-- Use a descriptive marker so an unrelated numeric 040 marker cannot skip it.
INSERT INTO chob_private.migrations(version) VALUES('040_rich_text_details') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;

SELECT jsonb_build_object(
 'migration','040_rich_text_details',
 'applied',EXISTS(SELECT 1 FROM chob_private.migrations WHERE version='040_rich_text_details'),
 'feed_oid',to_regprocedure('public.chob_public_feed()')::oid,
 'anon_execute',has_function_privilege('anon','public.chob_public_feed()','execute'),
 'authenticated_execute',has_function_privilege('authenticated','public.chob_public_feed()','execute'),
 'service_role_execute',has_function_privilege('service_role','public.chob_public_feed()','execute')
) AS rich_text_migration_summary;
