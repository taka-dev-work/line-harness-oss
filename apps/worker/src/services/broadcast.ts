import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  getQueuedBroadcasts,
  updateBroadcastStatus,
  updateBroadcastBatchProgress,
  getBroadcastAudienceByTag,
  materializeBroadcastDeliveries,
  expireBroadcastDeliveryRetryKeys,
  getRetryableBroadcastDeliveries,
  markBroadcastDeliveryAttempt,
  markBroadcastDeliverySent,
  getBroadcastDeliveryCounts,
  jstNow,
  updateBroadcastLineRequestId,
  createBroadcastInsight,
} from '@line-crm/db';
import type {
  Broadcast,
  BroadcastAudienceFriend,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';

function getRequiredBroadcastAccountId(broadcast: Broadcast): string {
  if (!broadcast.line_account_id) {
    throw new Error(`Broadcast ${broadcast.id} has no LINE account`);
  }
  return broadcast.line_account_id;
}

async function deliverBroadcastAudience(
  db: D1Database,
  lineClient: LineClient,
  broadcast: Broadcast,
  friends: BroadcastAudienceFriend[],
  message: Message,
  onDurableSent?: () => Promise<void>,
): Promise<{
  totalCount: number;
  sentCount: number;
  manualReviewCount: number;
}> {
  const accountId = getRequiredBroadcastAccountId(broadcast);
  const now = jstNow();

  await materializeBroadcastDeliveries(
    db,
    broadcast.id,
    accountId,
    friends,
    now,
  );
  await expireBroadcastDeliveryRetryKeys(db, broadcast.id, now);

  const deliveries = await getRetryableBroadcastDeliveries(
    db,
    broadcast.id,
    accountId,
    now,
  );

  for (const delivery of deliveries) {
    await markBroadcastDeliveryAttempt(db, delivery.id);
    try {
      await lineClient.pushMessage(
        delivery.line_user_id,
        [message],
        delivery.retry_key,
      );
      await markBroadcastDeliverySent(db, delivery, broadcast);
      await onDurableSent?.();
    } catch (error) {
      // The persisted uncertain state and retry key cover both a network ambiguity
      // and a crash after LINE accepted the request but before D1 recorded success.
      throw error;
    }
  }

  return getBroadcastDeliveryCounts(db, broadcast.id);
}

export async function processBroadcastSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  workerUrl?: string,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      const { requestId } = await lineClient.broadcast([message]);
      await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const accountId = getRequiredBroadcastAccountId(broadcast);
      const friends = await getBroadcastAudienceByTag(
        db,
        broadcast.target_tag_id,
        accountId,
      );
      const counts = await deliverBroadcastAudience(
        db,
        lineClient,
        broadcast,
        friends,
        message,
      );
      totalCount = counts.totalCount;
      successCount = counts.sentCount;
      await updateBroadcastLineRequestId(
        db,
        broadcast.id,
        null,
        `bcast_${broadcast.id.slice(0, 8)}`,
      );
    }

    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);

  const nowMs = Date.now();
  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    try {
      // Optimistic lock: claim this broadcast (scheduled → sending)
      const lockResult = await db
        .prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`)
        .bind(broadcast.id)
        .run();
      if (!lockResult.meta.changes || lockResult.meta.changes === 0) continue;

      // Resolve correct lineClient for this broadcast's account
      let deliveryClient = lineClient;
      const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
      if (accountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, accountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      await processBroadcastSend(db, deliveryClient, broadcast.id, workerUrl);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Reset to scheduled so it can be retried next cron
      try {
        await db.prepare(`UPDATE broadcasts SET status = 'scheduled' WHERE id = ? AND status = 'sending'`)
          .bind(broadcast.id).run();
      } catch (resetErr) {
        console.error(`Failed to reset broadcast ${broadcast.id} status:`, resetErr);
      }
    }
  }
}

/**
 * Cronから呼ばれるキュー処理。status='queued' のブロードキャストを
 * batch_offset から500人ずつ処理する。1回のCron実行で全バッチを処理可能。
 */
export async function processQueuedBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const queued = await getQueuedBroadcasts(db);
  for (const broadcast of queued) {
    // アカウント別のlineClientを解決
    const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
    let client = lineClient;
    if (accountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(db, accountId);
      if (account) client = new (await import('@line-crm/line-sdk')).LineClient(account.channel_access_token);
    }

    try {
      await processQueuedBroadcastBatches(db, client, broadcast, workerUrl);
    } catch (err) {
      console.error(`Failed to process queued broadcast ${broadcast.id}:`, err);
    }
  }
}

async function processQueuedBroadcastBatches(
  db: D1Database,
  lineClient: LineClient,
  broadcast: import('@line-crm/db').Broadcast,
  workerUrl?: string,
): Promise<void> {
  const segmentConditionsStr = broadcast.segment_conditions ?? null;
  const batchOffset = broadcast.batch_offset ?? 0;

  // Acquire a lease without changing durable progress.
  const lockResult = await db.prepare(
    `UPDATE broadcasts
     SET queue_locked_at = ?
     WHERE id = ? AND batch_offset = ? AND queue_locked_at IS NULL`,
  ).bind(jstNow(), broadcast.id, batchOffset).run();
  if (!lockResult.meta.changes || lockResult.meta.changes === 0) {
    // 他のCron実行が既に処理中 → スキップ
    return;
  }

  // auto-track（初回バッチのみ、offsetが0のとき）
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && batchOffset === 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
    // 変換後のコンテンツを保存（次バッチ以降で使えるように）
    if (finalType !== broadcast.message_type || finalContent !== broadcast.message_content) {
      await db.prepare('UPDATE broadcasts SET message_type = ?, message_content = ? WHERE id = ?')
        .bind(finalType, finalContent, broadcast.id).run();
    }
  }

  const raw = broadcast as unknown as Record<string, unknown>;
  const altText = raw.alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);

  const accountId = getRequiredBroadcastAccountId(broadcast);
  let friends: BroadcastAudienceFriend[];
  if (segmentConditionsStr) {
    const { buildSegmentQuery } = await import('./segment-query.js');
    const condition = JSON.parse(segmentConditionsStr);
    const { sql, bindings } = buildSegmentQuery(condition);
    const accountSql =
      sql.replace('WHERE ', 'WHERE f.line_account_id = ? AND (') + ')';
    const accountBindings = [accountId, ...bindings];
    const result = await db.prepare(accountSql).bind(...accountBindings).all<{ id: string; line_user_id: string }>();
    friends = result.results ?? [];
  } else if (broadcast.target_tag_id) {
    friends = await getBroadcastAudienceByTag(
      db,
      broadcast.target_tag_id,
      accountId,
    );
  } else {
    // target_type='all' でキューに入ることはないが、念のため
    const { requestId } = await lineClient.broadcast([message]);
    await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', { totalCount: 0, successCount: 0 });
    return;
  }

  const unit = `bcast_${broadcast.id.slice(0, 8)}`;
  const before = await getBroadcastDeliveryCounts(db, broadcast.id);
  let currentOffset = Math.max(batchOffset, before.sentCount);

  try {
    const counts = await deliverBroadcastAudience(
      db,
      lineClient,
      broadcast,
      friends,
      message,
      async () => {
        currentOffset += 1;
        await updateBroadcastBatchProgress(
          db,
          broadcast.id,
          currentOffset,
          1,
        );
      },
    );

    if (counts.sentCount + counts.manualReviewCount < counts.totalCount) {
      await updateBroadcastBatchProgress(
        db,
        broadcast.id,
        counts.sentCount,
        0,
        true,
      );
      return;
    }

    await db
      .prepare(
        `UPDATE broadcasts
         SET total_count = ?, success_count = ?, batch_offset = ?,
             queue_locked_at = NULL
         WHERE id = ?`,
      )
      .bind(
        counts.totalCount,
        counts.sentCount,
        counts.sentCount,
        broadcast.id,
      )
      .run();
  } catch (err) {
    console.error('Queued broadcast target send failed:', err);
    const counts = await getBroadcastDeliveryCounts(db, broadcast.id);
    await updateBroadcastBatchProgress(
      db,
      broadcast.id,
      counts.sentCount,
      0,
      true,
    );
    return;
  }

  await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
  await createBroadcastInsight(db, broadcast.id);
  await updateBroadcastStatus(db, broadcast.id, 'sent');
}

export function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  return { type: 'text', text: messageContent };
}
