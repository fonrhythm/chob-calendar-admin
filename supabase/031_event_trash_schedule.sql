-- Run as the database owner after 030_event_trash.sql.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('chob-purge-event-trash','*/5 * * * *','select chob_private.purge_event_trash();');
