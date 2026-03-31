-- Add file attachments support
-- Apply to database: psql $DATABASE_URL -f sql/add-file-attachments.sql

-- Create table for approval type file attachments configuration
CREATE TABLE IF NOT EXISTS approval_type_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type_id UUID NOT NULL REFERENCES approval_types(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL, -- Name of the form field that accepts files
  label TEXT NOT NULL, -- Display label for the file upload field
  required BOOLEAN NOT NULL DEFAULT false, -- Whether file attachment is required
  max_file_size_mb INTEGER NOT NULL DEFAULT 10, -- Maximum file size in MB
  allowed_extensions TEXT[] DEFAULT '{pdf,doc,docx,xls,xlsx,jpg,jpeg,png}', -- Allowed file extensions
  max_files INTEGER NOT NULL DEFAULT 1, -- Maximum number of files allowed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create table for request file attachments
CREATE TABLE IF NOT EXISTS request_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  approval_type_attachment_id UUID NOT NULL REFERENCES approval_type_attachments(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL, -- Name of the form field
  original_filename TEXT NOT NULL, -- Original filename when uploaded
  stored_filename TEXT NOT NULL, -- Generated filename for storage
  file_path TEXT NOT NULL, -- Path to the stored file
  file_size_bytes BIGINT NOT NULL, -- Size of the file in bytes
  mime_type TEXT NOT NULL, -- MIME type of the file
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_approval_type_attachments_type ON approval_type_attachments(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_field ON request_attachments(request_id, field_name);

-- Add file attachment support to approval_types table
ALTER TABLE approval_types ADD COLUMN IF NOT EXISTS allow_attachments BOOLEAN NOT NULL DEFAULT false;

-- Add file attachment support to approval_requests table
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false;
