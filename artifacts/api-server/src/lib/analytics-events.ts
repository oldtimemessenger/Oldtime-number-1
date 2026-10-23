import { pool } from "@workspace/db";
type PoolClient = Pick<typeof pool,"query">;
export async function recordAnalyticsEvent(client: PoolClient, input: {
  ownerId: string; actorId: string; resourceId?: string | null; kind: string; source: string; dedupKey: string; value?: number;
}) {
  if (input.ownerId === input.actorId) return false;
  const { rows } = await client.query(`INSERT INTO analytics_events(owner_id,actor_id,resource_id,kind,source,dedup_key,value)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
  [input.ownerId,input.actorId,input.resourceId || null,input.kind,input.source,input.dedupKey,input.value ?? 1]);
  if (!rows.length) return false;
  await client.query(`INSERT INTO analytics_daily(owner_id,day,kind,value) VALUES($1,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),$2,$3)
    ON CONFLICT(owner_id,day,kind) DO UPDATE SET value=analytics_daily.value+excluded.value`,
  [input.ownerId,input.kind,input.value ?? 1]);
  return true;
}
export async function analyticsTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
export function startAnalyticsMaintenance() {
  const timer = setInterval(async () => {
    // Raw events/playback retain 120 days; daily summaries retain two years.
    // Owner and actor account deletion cascade removes raw identifiable rows.
    await pool.query("DELETE FROM analytics_events WHERE created_at < now()-interval '120 days'; DELETE FROM analytics_sessions WHERE started_at < now()-interval '120 days'; DELETE FROM analytics_daily WHERE day < to_char(now()-interval '2 years','YYYY-MM-DD')").catch(() => {});
  },86400000); timer.unref();
}
