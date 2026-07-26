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
  queue_lease_token?: string | null;
  audience_cursor?: string | null;
  audience_materialized_at?: string | null;
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
  claim_token: string | null;
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
         AND queue_lease_token IS NULL
         AND sent_at IS NULL
         AND segment_conditions IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .all<Broadcast>();
  return result.results;
}

export async function getBroadcastAudienceByTag(
  db: D1Database,
  tagId: string,
  lineAccountId: string,
  afterFriendId = '',
  limit = 25,
): Promise<BroadcastAudienceFriend[]> {
  const result = await db
    .prepare(
      `SELECT f.id, f.line_user_id
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE f.line_account_id = ?
         AND ft.tag_id = ?
         AND f.is_following = 1
         AND f.id > ?
       ORDER BY f.id ASC
       LIMIT ?`,
    )
    .bind(lineAccountId, tagId, afterFriendId, limit)
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

export async function acquireBroadcastQueueLease(
  db: D1Database,
  broadcastId: string,
  batchOffset: number,
  leaseToken: string,
  now = jstNow(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET queue_locked_at = ?, queue_lease_token = ?
       WHERE id = ?
         AND batch_offset = ?
         AND queue_locked_at IS NULL
         AND queue_lease_token IS NULL`,
    )
    .bind(now, leaseToken, broadcastId, batchOffset)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function materializeBroadcastAudiencePage(
  db: D1Database,
  broadcastId: string,
  lineAccountId: string,
  leaseToken: string,
  friends: BroadcastAudienceFriend[],
  cursor: string,
  complete: boolean,
  now = jstNow(),
): Promise<boolean> {
  const statements = friends.map((friend) =>
    db
      .prepare(
        `INSERT INTO broadcast_deliveries
           (id, broadcast_id, friend_id, line_account_id, status, attempt_count,
            retry_key, retry_key_created_at, last_error, created_at, updated_at)
         SELECT ?, b.id, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?
         FROM broadcasts b
         WHERE b.id = ?
           AND b.line_account_id = ?
           AND b.queue_lease_token = ?
         ON CONFLICT(broadcast_id, friend_id) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        friend.id,
        lineAccountId,
        crypto.randomUUID(),
        now,
        now,
        now,
        broadcastId,
        lineAccountId,
        leaseToken,
      ),
  );
  statements.push(
    db
      .prepare(
        `UPDATE broadcasts
         SET audience_cursor = ?,
             audience_materialized_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
             total_count = (
               SELECT COUNT(*) FROM broadcast_deliveries
               WHERE broadcast_id = broadcasts.id
             ),
             queue_locked_at = NULL,
             queue_lease_token = NULL
         WHERE id = ?
           AND line_account_id = ?
           AND queue_lease_token = ?`,
      )
      .bind(
        cursor,
        complete ? 1 : 0,
        now,
        broadcastId,
        lineAccountId,
        leaseToken,
      ),
  );
  const results = await db.batch(statements);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

export async function getRetryableBroadcastDeliveries(
  db: D1Database,
  broadcastId: string,
  lineAccountId: string,
  limit = 8,
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
         AND d.status IN ('pending', 'uncertain')
       ORDER BY d.created_at ASC, d.id ASC
       LIMIT ?`,
    )
    .bind(broadcastId, lineAccountId, limit)
    .all<BroadcastDelivery>();
  return result.results ?? [];
}

export async function claimBroadcastDelivery(
  db: D1Database,
  deliveryId: string,
  leaseToken: string,
  now = jstNow(),
): Promise<BroadcastDelivery | null> {
  return db
    .prepare(
      `UPDATE broadcast_deliveries
       SET status = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN 'manual_review'
             ELSE 'uncertain'
           END,
           attempt_count = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN attempt_count
             ELSE attempt_count + 1
           END,
           first_attempted_at = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN first_attempted_at
             ELSE COALESCE(first_attempted_at, ?)
           END,
           last_attempted_at = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN last_attempted_at
             ELSE ?
           END,
           claim_token = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN NULL
             ELSE ?
           END,
           last_error = CASE
             WHEN first_attempted_at IS NOT NULL
              AND julianday(?) - julianday(first_attempted_at) >= 1
             THEN 'LINE retry key expired after 24 hours; manual review required'
             ELSE last_error
           END,
           updated_at = ?
       WHERE id = ?
         AND status IN ('pending', 'uncertain')
         AND EXISTS (
           SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_deliveries.broadcast_id
             AND b.queue_lease_token = ?
         )
       RETURNING *`,
    )
    .bind(now, now, now, now, now, now, now, leaseToken, now, now, deliveryId, leaseToken)
    .first<BroadcastDelivery>();
}

export async function markBroadcastDeliverySent(
  db: D1Database,
  delivery: BroadcastDelivery,
  broadcast: Broadcast,
  leaseToken: string,
  now = jstNow(),
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE broadcast_deliveries
         SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ?
         WHERE id = ?
           AND claim_token = ?
           AND EXISTS (
             SELECT 1 FROM broadcasts b
             WHERE b.id = broadcast_deliveries.broadcast_id
               AND b.queue_lease_token = ?
           )`,
      )
      .bind(now, now, delivery.id, leaseToken, leaseToken),
    db
      .prepare(
        `INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, broadcast_id,
            scenario_step_id, source, broadcast_delivery_id, created_at)
         SELECT ?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?
         FROM broadcast_deliveries d
         INNER JOIN broadcasts b ON b.id = d.broadcast_id
         WHERE d.id = ?
           AND d.status = 'sent'
           AND d.claim_token = ?
           AND b.queue_lease_token = ?
         ON CONFLICT(broadcast_delivery_id) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        delivery.friend_id,
        broadcast.message_type,
        broadcast.message_content,
        broadcast.id,
        delivery.id,
        now,
        delivery.id,
        leaseToken,
        leaseToken,
      ),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function markBroadcastDeliveryFailed(
  db: D1Database,
  deliveryId: string,
  leaseToken: string,
  lastError: string,
  now = jstNow(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcast_deliveries
       SET status = 'failed', last_error = ?, claim_token = NULL, updated_at = ?
       WHERE id = ?
         AND claim_token = ?
         AND EXISTS (
           SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_deliveries.broadcast_id
             AND b.queue_lease_token = ?
         )`,
    )
    .bind(lastError, now, deliveryId, leaseToken, leaseToken)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markBroadcastDeliveryUncertain(
  db: D1Database,
  deliveryId: string,
  leaseToken: string,
  lastError: string,
  now = jstNow(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcast_deliveries
       SET last_error = ?, updated_at = ?
       WHERE id = ? AND claim_token = ?
         AND EXISTS (
           SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_deliveries.broadcast_id
             AND b.queue_lease_token = ?
         )`,
    )
    .bind(lastError, now, deliveryId, leaseToken, leaseToken)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getBroadcastDeliveryCounts(
  db: D1Database,
  broadcastId: string,
): Promise<{
  totalCount: number;
  sentCount: number;
  manualReviewCount: number;
  failedCount: number;
  remainingCount: number;
}> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
              SUM(CASE WHEN status = 'manual_review' THEN 1 ELSE 0 END) AS manual_review_count
              ,SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
              ,SUM(CASE WHEN status IN ('pending', 'uncertain') THEN 1 ELSE 0 END) AS remaining_count
       FROM broadcast_deliveries
       WHERE broadcast_id = ?`,
    )
    .bind(broadcastId)
    .first<{
      total_count: number;
      sent_count: number | null;
      manual_review_count: number | null;
      failed_count: number | null;
      remaining_count: number | null;
    }>();
  return {
    totalCount: row?.total_count ?? 0,
    sentCount: row?.sent_count ?? 0,
    manualReviewCount: row?.manual_review_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    remainingCount: row?.remaining_count ?? 0,
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
           queue_locked_at = NULL,
           queue_lease_token = NULL
       WHERE status = 'sending'
         AND sent_at IS NULL
         AND segment_conditions IS NOT NULL
         AND queue_locked_at IS NOT NULL
         AND julianday('now') - julianday(queue_locked_at) > 0.021`,
    )
    .run();
}

export async function updateBroadcastBatchProgress(
  db: D1Database,
  id: string,
  leaseToken: string,
  releaseLock = false,
  now = jstNow(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET batch_offset = (
             SELECT COUNT(*) FROM broadcast_deliveries
             WHERE broadcast_id = broadcasts.id
               AND status IN ('sent', 'failed', 'manual_review')
           ),
           success_count = (
             SELECT COUNT(*) FROM broadcast_deliveries
             WHERE broadcast_id = broadcasts.id AND status = 'sent'
           ),
           queue_locked_at = CASE WHEN ? = 1 THEN NULL ELSE ? END,
           queue_lease_token = CASE WHEN ? = 1 THEN NULL ELSE queue_lease_token END
       WHERE id = ? AND queue_lease_token = ?`,
    )
    .bind(releaseLock ? 1 : 0, now, releaseLock ? 1 : 0, id, leaseToken)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function completeBroadcastQueue(
  db: D1Database,
  id: string,
  leaseToken: string,
  aggregationUnit: string,
  now = jstNow(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET status = 'sent',
           sent_at = ?,
           aggregation_unit = ?,
           total_count = (
             SELECT COUNT(*) FROM broadcast_deliveries
             WHERE broadcast_id = broadcasts.id
           ),
           success_count = (
             SELECT COUNT(*) FROM broadcast_deliveries
             WHERE broadcast_id = broadcasts.id AND status = 'sent'
           ),
           batch_offset = (
             SELECT COUNT(*) FROM broadcast_deliveries
             WHERE broadcast_id = broadcasts.id
               AND status IN ('sent', 'failed', 'manual_review')
           ),
           queue_locked_at = NULL,
           queue_lease_token = NULL
       WHERE id = ?
         AND queue_lease_token = ?
         AND audience_materialized_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM broadcast_deliveries
           WHERE broadcast_id = broadcasts.id
             AND status IN ('pending', 'uncertain')
         )`,
    )
    .bind(now, aggregationUnit, id, leaseToken)
    .run();
  return (result.meta.changes ?? 0) > 0;
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
