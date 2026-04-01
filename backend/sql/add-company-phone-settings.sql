-- Add phone settings to company_settings for admin configuration
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS landline_number TEXT;
