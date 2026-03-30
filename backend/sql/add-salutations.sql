-- Add pre and post salutation fields to approval_types
ALTER TABLE approval_types
ADD COLUMN pre_salutation TEXT,
ADD COLUMN post_salutation TEXT;