BEGIN;
-- Keep old type references for traceability; add the agreed display category separately.
UPDATE public.events e SET attributes=coalesce(e.attributes,'{}'::jsonb)||jsonb_build_object('activity_category',public.chob_activity_category((SELECT to_jsonb(t)->>'name' FROM public.event_type_definitions t WHERE t.id=e.event_type_id))) WHERE NOT coalesce(e.attributes,'{}'::jsonb) ? 'activity_category';
NOTIFY pgrst,'reload schema';
COMMIT;
