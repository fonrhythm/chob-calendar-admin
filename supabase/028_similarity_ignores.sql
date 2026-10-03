BEGIN;
CREATE TABLE IF NOT EXISTS public.chob_similarity_ignores (
 id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 event_a uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 event_b uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 ignored_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 ignored_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_a,event_b), CHECK(event_a<event_b)
);
ALTER TABLE public.chob_similarity_ignores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chob_similarity_ignores FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public.chob_similarity_ignores TO authenticated;
GRANT INSERT(event_a,event_b) ON public.chob_similarity_ignores TO authenticated;
DROP POLICY IF EXISTS similarity_read ON public.chob_similarity_ignores;
CREATE POLICY similarity_read ON public.chob_similarity_ignores FOR SELECT TO authenticated USING(chob_private.can_edit_events());
DROP POLICY IF EXISTS similarity_add ON public.chob_similarity_ignores;
CREATE POLICY similarity_add ON public.chob_similarity_ignores FOR INSERT TO authenticated WITH CHECK(chob_private.can_edit_events() AND ignored_by=auth.uid());
DROP POLICY IF EXISTS similarity_remove ON public.chob_similarity_ignores;
CREATE POLICY similarity_remove ON public.chob_similarity_ignores FOR DELETE TO authenticated USING(chob_private.can_edit_events());
INSERT INTO chob_private.migrations(version) VALUES('028') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
