-- Fix for Infinite "Online" Loop caused by Trigger-Cron Conflict
--
-- Problem: 
-- The previous trigger `handle_device_heartbeat` updated `last_seen = now()` on ANY update.
-- When the Cron Job tried to set `status = 'offline'`, the trigger fired, 
-- reset `last_seen` to `now()`, and forced `status` back to 'online'.
--
-- Fix:
-- Detect if the update is a "Mark Offline" operation (status changing from online to offline).
-- If so, bypass the timestamp update.

CREATE OR REPLACE FUNCTION public.handle_device_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Exit early if this is a "Mark Offline" operation
  -- (e.g., from the Cron Job or manual admin update)
  IF NEW.status = 'offline' AND OLD.status = 'online' THEN
    RETURN NEW;
  END IF;

  -- 2. For all other updates (Device Heartbeat, etc.), update timestamp
  NEW.last_seen := now();
  NEW.status := 'online';
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Notify user
-- Please copy-paste this into Supabase SQL Editor to apply the fix.
