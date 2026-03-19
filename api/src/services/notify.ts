import { query } from '../db';

export async function scheduleNotification(
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO notification_jobs (type, payload, status, attempts) VALUES ($1, $2, 'PENDING', 0)`,
    [type, JSON.stringify(payload)]
  );
}

export async function sendPushToFollowers(
  carId: string,
  title: string,
  body: string
): Promise<void> {
  await scheduleNotification('PUSH_FOLLOWERS', { carId, title, body });
}
