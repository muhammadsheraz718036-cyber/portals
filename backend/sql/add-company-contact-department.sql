-- Add department field to company_settings for contact information
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS contact_department TEXT DEFAULT 'MIS Department';