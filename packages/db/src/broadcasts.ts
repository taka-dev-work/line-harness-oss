import { jstNow } from './utils.js';
export type BroadcastTargetType = 'all' | 'tag';
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent';
export type BroadcastMessageType = 'text' | 'image' | 'flex';

export interface Broadcast {
  id: string;
  title: string;
  message_type: BroadcastMessageType;
  message_content: string;
  target_type: BroadcastTargetType;
  target_tag_id: string | null;
  status: BroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_count: number;
  success_count: number;
  line_account_id?: string | null;
  batch_offset?: number;
  segment_conditions?: string | null;
  queue_locked_at?: string | null;
  created_at: string;
}

export interface BroadcastAudienceFriend {
  id: string;
  line_user_id: string;
}

export type BroadcastDeliveryStatus =
  | 'pending'
  | 'uncertain'
  | 'failed'
  | 'sent'
  | 'manual_review';

export interface BroadcastDelivery {
  id: string;
  broadcast_id: string;
  friend_id: string;
  line_account_id: string;
  line_user_id: string;
  status: BroadcastDeliveryStatus;
  attempt_count: number;
  retry_key: string;
  retry_key_created_at: string;
  first_attempted_at: string | null;
  last_error: string | null;
}

export async function getBroadcasts(db: D1Database, accountId?: string): Promise<Broadcast[]> {
  let sql = `SELECT b.*,
       bi.status as insight_status,
       bi.open_rate, bi.click_rate
FROM broadcasts b
LEFT JOIN broadcast_insights bi ON b.id = bi.broadcast_id
  AND bi.id = (SELECT id FROM broadcast_insights WHERE broadcast_id = b.id ORDER BY created_at DESC LIMIT 1)`;
  const params: unknown[] = [];
  if (accountId) {
    sql += ` WHERE b.line_account_id = ?`;
    params.push(accountId);
  }
  sql += ` ORDER BY COALESCE(b.sent_at, b.scheduled_at, b.created_at) DESC`;
  const result = params.length > 0
    ? await db.prepare(sql).bind(...params).all<Broadcast>()
    : await db.prepare(sql).all<Broadcast>();
  return result.results;
}

export async function getBroadcastById(
  db: D1Database,
  id: string,
): Promise<Broadcast | null> {
  return db
    .prepare(
      `SELECT b.*,
       bi.id as insight_id, bi.delivered, bi.unique_impression,
       bi.unique_click, bi.unique_media_played,
       bi.open_rate, bi.click_rate, bi.status as insight_status,
       bi.retry_count, bi.fetched_at as insight_fetched_at,
       bi.created_at as insight_created_at
FROM broadcasts b
LEFT JOIN broadcast_insights bi ON b.id = bi.broadcast_id
WHERE b.id = ?`,
    )
    .bind(id)
    .first<Broadcast>();
}

export interface CreateBroadcastInput {
  title: string;
  messageType: BroadcastMessageType;
  messageContent: string;
  targetType: BroadcastTargetType;
  targetTagId?: string | null;
  scheduledAt?: string | null;
}

export async function createBroadcast(
  db: D1Database,
  input: CreateBroadcastInput,
): Promise<Broadcast> {
  const id = crypto.randomUUID();
  const now = jstNow();

  const initialStatus: BroadcastStatus = input.scheduledAt ? 'scheduled' : 'draft';

  await db
    .prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, target_tag_id, status, scheduled_at, sent_at, total_count, success_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)`,
    )
    .bind(
      id,
      input.title,
      input.messageType,
      input.messageContent,
      input.targetType,
      input.targetTagId ?? null,
      initialStatus,
      input.scheduledAt ?? null,
      now,
    )
    .run();

  return (await getBroadcastById(db, id))!;
}

export type UpdateBroadcastInput = Partial<
  Pick<
    Broadcast,
    | 'title'
    | 'message_type'
    | 'message_content'
    | 'target_type'
    | 'target_tag_id'
    | 'status'
    | 'scheduled_at'
  >
>;

export async function updateBroadcast(
  db: D1Database,
  id: string,
  updates: UpdateBroadcastInput,
): Promise<Broadcast | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.message_content !== undefined) {
    fields.push('message_content = ?');
    values.push(updates.message_content);
  }
  if (updates.target_type !== undefined) {
    fields.push('target_type = ?');
    values.push(updates.target_type);
  }
  if (updates.target_tag_id !== undefined) {
    fields.push('target_tag_id = ?');
    values.push(updates.target_tag_id);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.scheduled_at !== undefined) {
    fields.push('scheduled_at = ?');
    values.push(updates.scheduled_at);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return getBroadcastById(db, id);
}

export async function deleteBroadcast(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM broadcasts WHERE id = ?`).bind(id).run();
}

export async function createBroadcastInsight(
  db: D1Database,
  broadcastId: string,
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO broadcast_insights (id, broadcast_id, status) VALUES (?, ?, 'pending')`,
    )
    .bind(id, broadcastId)
    .run();
}

export async function updateBroadcastLineRequestId(
  db: D1Database,
  broadcastId: string,
  lineRequestId: string | null,
  aggregationUnit: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts SET line_request_id = ?, aggregation_unit = ? WHERE id = ?`,
    )
    .bind(lineRequestId, aggregationUnit, broadcastId)
    .run();
}

export async function getPendingInsights(
  db: D1Database,
): Promise<
  Array<{
    insightId: string;
    broadcastId: string;
    lineRequestId: string | null;
    aggregationUnit: string | null;
    sentAt: string;
    retryCount: number;
    lineAccountId: string | null;
  }>
> {
  const result = await db
    .prepare(
      `SELECT bi.id as insight_id, bi.broadcast_id, bi.retry_count,
              b.line_request_id, b.aggregation_unit, b.sent_at, b.line_account_id
       FROM broadcast_insights bi
       JOIN broadcasts b ON bi.broadcast_id = b.id
       WHERE bi.status = 'pending'
         AND b.sent_at IS NOT NULL
         AND julianday('now', '+9 hours') - julianday(b.sent_at) >= 3`,
    )
    .all();
  return (result.results || []).map((r: Record<string, unknown>) => ({
    insightId: r.insight_id as string,
    broadcastId: r.broadcast_id as string,
    lineRequestId: r.line_request_id as string | null,
    aggregationUnit: r.aggregation_unit as string | null,
    sentAt: r.sent_at as string,
    retryCount: r.retry_count as number,
    lineAccountId: r.line_account_id as string | null,
  }));
}

export async function updateInsightResult(
  db: D1Database,
  insightId: string,
  result: {
    delivered: number | null;
    uniqueImpression: number | null;
    uniqueClick: number | null;
    uniqueMediaPlayed: number | null;
    rawResponse: string;
  },
): Promise<void> {
  const openRate =
    result.delivered && result.uniqueImpression
      ? result.uniqueImpression / result.delivered
      : null;
  const clickRate =
    result.delivered && result.uniqueClick
      ? result.uniqueClick / result.delivered
      : null;
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `UPDATE broadcast_insights
       SET delivered = ?, unique_impression = ?, unique_click = ?,
           unique_media_played = ?, open_rate = ?, click_rate = ?,
           raw_response = ?, status = 'ready', fetched_at = ?
       WHERE id = ?`,
    )
    .bind(
      result.delivered,
      result.uniqueImpression,
      result.uniqueClick,
      result.uniqueMediaPlayed,
      openRate,
      clickRate,
      result.rawResponse,
      now,
      insightId,
    )
    .run();
}

export async function markInsightFailed(
  db: D1Database,
  insightId: string,
  retryCount: number,
): Promise<void> {
  const newStatus = retryCount >= 2 ? 'failed' : 'pending';
  await db
    .prepare(
      `UPDATE broadcast_insights SET retry_count = ?, status = ? WHERE id = ?`,
    )
    .bind(retryCount + 1, newStatus, insightId)
    .run();
}

export async function getQueuedBroadcasts(db: D1Database): Promise<Broadcast[]> {
  // Only pick up broadcasts explicitly queued via segment_conditions
  // (segment_conditions IS NOT NULL distinguishes queued batches from normal tag sends)
  // queue_locked_at IS NULL: another Worker does not hold the lease
  // sent_at IS NULL: 完了済みは除外
  const result = await db
    .prepare(
      `SELECT * FROM broadcasts
       WHERE status = 'sending'
         AND batch_offset >= 0
         AND queue_locked_at IS NULL
         AND sent_at IS NULL
         AND segment_conditions IS NOT NULL
       ORDER BY created_at ASC`,
    )
    .all<Broadcast>();
  return result.results;
}

export async function getBroadcastAudienceByTag(
  db: D1Database,
  tagId: string,
  lineAccountId: string,
): Promise<BroadcastAudienceFriend[]> {
  const result = await db
    .prepare(
      `SELECT f.id, f.line_user_id
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE f.line_account_id = ?
         AND ft.tag_id = ?
         AND f.is_following = 1
       ORDER BY f.created_at ASC, f.id ASC`,
    )
    .bind(lineAccountId, tagId)
    .all<BroadcastAudienceFriend>();
  return result.results ?? [];
}

export async function materializeBroadcastDeliveries(
  db: D1Database,
  broadcastId: string,
  lineAccountId: string,
  friends: BroadcastAudienceFriend[],
  now = jstNow(),
): Promise<void> {
  if (friends.length === 0) return;

  await db.batch(
    friends.map((friend) =>
      db
        .prepare(
          `INSERT INTO broadcast_deliveries
             (id, broadcast_id, friend_id, line_account_id, status, attempt_count,
              retry_key, retry_key_created_at, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?)
           ON CONFLICT(broadcast_id, friend_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          broadcastId,
          friend.id,
          lineAccountId,
          crypto.randomUUID(),
          now,
          now,
          now,
        ),
    ),
  );
}

export async function expireBroadcastDeliveryRetryKeys(
  db: D1Database,
  broadcastId: string,
  now = jstNow(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcast_deliveries
       SET status = 'manual_review',
           last_error = 'LINE retry key expired after 24 hours; manual review required',
           updated_at = ?
       WHERE broadcast_id = ?
         AND status IN ('failed', 'uncertain')
         AND first_attempted_at IS NOT NULL
         AND julianday(?) - julianday(first_attempted_at) >= 1`,
    )
    .bind(now, broadcastId, now)
    .run();
}

export async function getRetryableBroadcastDeliveries(
  db: D1Database,
  broadcastId: string,
  lineAccountId: string,
  now = jstNow(),
): Promise<BroadcastDelivery[]> {
  const result = await db
    .prepare(
      `SELECT d.*, f.line_user_id
       FROM broadcast_deliveries d
       INNER JOIN friends f
         ON f.id = d.friend_id
        AND f.line_account_id = d.line_account_id
       WHERE d.broadcast_id = ?
         AND d.line_account_id = ?
         AND d.status IN ('pending', 'failed', 'uncertain')
         AND (
           d.first_attempted_at IS NULL
           OR julianday(?) - julianday(d.first_attempted_at) < 1
         )
       ORDER BY d.created_at ASC, d.id ASC`,
    )
    .bind(broadcastId, lineAccountId, now)
    .all<BroadcastDelivery>();
  return result.results ?? [];
}

export async function markBroadcastDeliveryAttempt(
  db: D1Database,
  deliveryId: string,
  now = jstNow(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcast_deliveries
       SET status = 'uncertain',
           attempt_count = attempt_count + 1,
           first_attempted_at = COALESCE(first_attempted_at, ?),
           last_attempted_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, now, now, deliveryId)
    .run();
}

export async function markBroadcastDeliverySent(
  db: D1Database,
  delivery: BroadcastDelivery,
  broadcast: Broadcast,
  now = jstNow(),
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE broadcast_deliveries
         SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, delivery.id),
    db
      .prepare(
        `INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, broadcast_id,
            scenario_step_id, source, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        delivery.friend_id,
        broadcast.message_type,
        broadcast.message_content,
        broadcast.id,
        now,
      ),
  ]);
}

export async function getBroadcastDeliveryCounts(
  db: D1Database,
  broadcastId: string,
): Promise<{
  totalCount: number;
  sentCount: number;
  manualReviewCount: number;
}> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
              SUM(CASE WHEN status = 'manual_review' THEN 1 ELSE 0 END) AS manual_review_count
       FROM broadcast_deliveries
       WHERE broadcast_id = ?`,
    )
    .bind(broadcastId)
    .first<{
      total_count: number;
      sent_count: number | null;
      manual_review_count: number | null;
    }>();
  return {
    totalCount: row?.total_count ?? 0,
    sentCount: row?.sent_count ?? 0,
    manualReviewCount: row?.manual_review_count ?? 0,
  };
}

export async function recoverStalledBroadcasts(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts
       SET batch_offset = COALESCE(
             (SELECT COUNT(*)
              FROM broadcast_deliveries d
              WHERE d.broadcast_id = broadcasts.id AND d.status = 'sent'),
             0
           ),
           success_count = COALESCE(
             (SELECT COUNT(*)
              FROM broadcast_deliveries d
              WHERE d.broadcast_id = broadcasts.id AND d.status = 'sent'),
             0
           ),
           queue_locked_at = NULL
       WHERE status = 'sending'
         AND sent_at IS NULL
         AND segment_conditions IS NOT NULL
         AND queue_locked_at IS NOT NULL
         AND julianday('now', '+9 hours') - julianday(queue_locked_at) > 0.021`,
    )
    .run();
}

export async function updateBroadcastBatchProgress(
  db: D1Database,
  id: string,
  batchOffset: number,
  additionalSuccess: number,
  releaseLock = false,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts
       SET batch_offset = ?,
           success_count = success_count + ?,
           queue_locked_at = CASE WHEN ? = 1 THEN NULL ELSE ? END
       WHERE id = ?`,
    )
    .bind(
      batchOffset,
      additionalSuccess,
      releaseLock ? 1 : 0,
      jstNow(),
      id,
    )
    .run();
}

export interface BroadcastStatusCounts {
  totalCount?: number;
  successCount?: number;
}

export async function updateBroadcastStatus(
  db: D1Database,
  id: string,
  status: BroadcastStatus,
  counts?: BroadcastStatusCounts,
): Promise<void> {
  const fields: string[] = ['status = ?'];
  const values: unknown[] = [status];

  if (status === 'sent') {
    fields.push('sent_at = ?');
    values.push(jstNow());
  }
  if (counts?.totalCount !== undefined) {
    fields.push('total_count = ?');
    values.push(counts.totalCount);
  }
  if (counts?.successCount !== undefined) {
    fields.push('success_count = ?');
    values.push(counts.successCount);
  }

  values.push(id);
  await db
    .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}
