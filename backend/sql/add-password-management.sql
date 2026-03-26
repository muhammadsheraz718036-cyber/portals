-- Add password management fields to profiles table
ALTER TABLE profiles
ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN locked_at TIMESTAMPTZ,
ADD COLUMN last_failed_login_at TIMESTAMPTZ;

-- Create index for efficient queries on locked accounts
CREATE INDEX idx_profiles_is_locked ON profiles(is_locked) WHERE is_locked = true;