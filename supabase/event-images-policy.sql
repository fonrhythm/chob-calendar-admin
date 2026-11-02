BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('chob-event-images','chob-event-images',true,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS chob_event_images_insert ON storage.objects;
CREATE POLICY chob_event_images_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='chob-event-images' AND (storage.foldername(name))[1]=auth.uid()::text AND chob_private.can_edit_events());
COMMIT;
