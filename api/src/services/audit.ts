import { query } from '../db';

export async function auditLog(
  userId: string | null,
  action: string,
  resourceType?: string,
  resourceId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, resourceType ?? null, resourceId ?? null,
       details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    // Audit log failures should not block main operations
    console.error('Audit log error:', err);
  }
}
