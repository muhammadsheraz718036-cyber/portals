-- Add pre and post salutation fields to approval_types
-- This migration adds salutation support for approval letters
ALTER TABLE approval_types
ADD COLUMN IF NOT EXISTS pre_salutation TEXT,
ADD COLUMN IF NOT EXISTS post_salutation TEXT;