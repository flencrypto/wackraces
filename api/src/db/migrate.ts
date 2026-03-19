import * as fs from 'fs';
import * as path from 'path';
import { pool } from './index';

async function migrate(): Promise<void> {
  const sqlPath = path.join(__dirname, '../../migrations/001_initial.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
