import { pool } from '../src/db.js';
import fs from 'fs/promises';
import path from 'path';

async function applyFileAttachmentsSchema() {
  const client = await pool.connect();
  try {
    console.log('Applying file attachments schema...');
    
    const schemaPath = path.join(process.cwd(), 'sql', 'add-file-attachments.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    
    await client.query('BEGIN');
    await client.query(schema);
    await client.query('COMMIT');
    
    console.log('File attachments schema applied successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to apply file attachments schema:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

applyFileAttachmentsSchema().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
