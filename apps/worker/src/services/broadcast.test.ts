import { describe, expect, it, vi } from 'vitest';
import { recoverStalledBroadcasts } from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { processBroadcastSend, processQueuedBroadcasts } from './broadcast.js';

const ACCOUNT_A = 'account-a';
const RETRY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FriendRow = {
  id: string;
  line_user_id: string;
  line_account_id: string;
  is_following: number;
  tag_id: string;
};

type DeliveryRow = {
  id: string;
  broadcast_id: string;
  friend_id: string;
  line_account_id: string;
  status: 'pending' | 'uncertain' | 'failed' | 'sent' | 'manual_review';
  attempt_count: number;
  retry_key: string;
  retry_key_created_at: string;
  first_attempted_at: string | null;
  last_error: string | null;
};

function makeBroadcast(overrides: Partial<Broadcast & Record<string, unknown>> = {}) {
  return {
    id: 'broadcast-1',
    title: 'Account A broadcast',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'tag',
    target_tag_id: 'tag-1',
    status: 'draft',
    scheduled_at: null,
    sent_at: null,
    total_count: 0,
    success_count: 0,
    created_at: '2026-07-27T00:00:00.000Z',
    line_account_id: ACCOUNT_A,
    batch_offset: 0,
    segment_conditions: null,
    ...overrides,
  } as Broadcast;
}

class FakeStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    readonly sql: string,
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    this.db.boundSql.push({ sql: this.sql, bindings });
    return this;
  }

  async first<T>() {
    return this.db.first(this.sql, this.bindings) as T | null;
  }

  async all<T>() {
    return { results: this.db.all(this.sql, this.bindings) as T[] };
  }

  async run() {
    return this.db.run(this.sql, this.bindings);
  }
}

class FakeD1 {
  readonly boundSql: Array<{ sql: string; bindings: unknown[] }> = [];
  readonly deliveries = new Map<string, DeliveryRow>();
  readonly messageLog: string[] = [];
  failNextSentRecord = false;

  constructor(
    readonly broadcast: Broadcast,
    readonly friends: FriendRow[],
  ) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }

  first(sql: string, bindings: unknown[]) {
    if (sql.includes('FROM broadcasts b')) return this.broadcast;
    if (sql.includes('FROM line_accounts')) return null;
    if (sql.includes('COUNT(*)') && sql.includes('broadcast_deliveries')) {
      const rows = [...this.deliveries.values()].filter((d) => d.broadcast_id === bindings[0]);
      return {
        total_count: rows.length,
        sent_count: rows.filter((d) => d.status === 'sent').length,
        manual_review_count: rows.filter((d) => d.status === 'manual_review').length,
      };
    }
    return null;
  }

  all(sql: string, bindings: unknown[]) {
    if (
      sql.includes('SELECT * FROM broadcasts') &&
      sql.includes("status = 'sending'")
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      return raw.queue_locked_at ? [] : [this.broadcast];
    }
    if (sql.includes('FROM friends f') && sql.includes('friend_tags')) {
      const [accountId, tagId] = sql.indexOf('f.line_account_id = ?') < sql.indexOf('ft.tag_id = ?')
        ? bindings
        : [bindings[1], bindings[0]];
      return this.friends.filter(
        (f) =>
          f.line_account_id === accountId &&
          f.tag_id === tagId &&
          f.is_following === 1,
      );
    }
    if (sql.includes('FROM friends f WHERE')) {
      const accountId = bindings[0];
      return this.friends.filter(
        (f) => f.line_account_id === accountId && f.is_following === 1,
      );
    }
    if (sql.includes('FROM broadcast_deliveries')) {
      return [...this.deliveries.values()]
        .filter((d) => d.broadcast_id === bindings[0])
        .filter((d) => ['pending', 'failed', 'uncertain'].includes(d.status))
        .map((d) => ({
          ...d,
          line_user_id: this.friends.find((f) => f.id === d.friend_id)?.line_user_id,
        }));
    }
    return [];
  }

  run(sql: string, bindings: unknown[]) {
    if (sql.includes('INSERT INTO broadcast_deliveries')) {
      const [id, broadcastId, friendId, accountId, retryKey, retryKeyCreatedAt] =
        bindings as string[];
      const identity = `${broadcastId}:${friendId}`;
      if (this.deliveries.has(identity) && !sql.includes('ON CONFLICT')) {
        throw new Error('duplicate broadcast delivery');
      }
      if (!this.deliveries.has(identity)) {
        this.deliveries.set(identity, {
          id,
          broadcast_id: broadcastId,
          friend_id: friendId,
          line_account_id: accountId,
          status: 'pending',
          attempt_count: 0,
          retry_key: retryKey,
          retry_key_created_at: retryKeyCreatedAt,
          first_attempted_at: null,
          last_error: null,
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'manual_review'")) {
      for (const delivery of this.deliveries.values()) {
        const ageMs =
          new Date(String(bindings[0])).getTime() -
          new Date(String(delivery.first_attempted_at)).getTime();
        if (
          delivery.broadcast_id === bindings[1] &&
          delivery.first_attempted_at !== null &&
          ageMs >= 24 * 60 * 60_000
        ) {
          delivery.status = 'manual_review';
        }
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'uncertain'")) {
      const delivery = [...this.deliveries.values()].find((d) => d.id === bindings.at(-1));
      if (delivery) {
        delivery.status = 'uncertain';
        delivery.attempt_count += 1;
        delivery.first_attempted_at ??= String(bindings[0]);
      }
      return { meta: { changes: delivery ? 1 : 0 } };
    }
    if (sql.includes("SET status = 'sent'") && sql.includes('broadcast_deliveries')) {
      if (this.failNextSentRecord) {
        this.failNextSentRecord = false;
        throw new Error('simulated crash after LINE acceptance');
      }
      const delivery = [...this.deliveries.values()].find((d) => d.id === bindings.at(-1));
      if (delivery) delivery.status = 'sent';
      return { meta: { changes: delivery ? 1 : 0 } };
    }
    if (sql.includes("SET status = 'failed'") && sql.includes('broadcast_deliveries')) {
      const delivery = [...this.deliveries.values()].find((d) => d.id === bindings.at(-1));
      if (delivery) {
        delivery.status = 'failed';
        delivery.last_error = String(bindings[0]);
      }
      return { meta: { changes: delivery ? 1 : 0 } };
    }
    if (sql.includes('INSERT INTO messages_log')) {
      this.messageLog.push(String(bindings[1]));
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('SET queue_locked_at = ?') &&
      sql.includes('queue_locked_at IS NULL')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (raw.batch_offset !== bindings.at(-1)) return { meta: { changes: 0 } };
      if (raw.queue_locked_at) return { meta: { changes: 0 } };
      raw.queue_locked_at = bindings[0];
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('UPDATE broadcasts') &&
      sql.includes('queue_locked_at') &&
      sql.includes('batch_offset = COALESCE')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      const lockedAt = new Date(String(raw.queue_locked_at)).getTime();
      if (
        Date.now() - lockedAt > 30 * 60_000
      ) {
        raw.batch_offset = [...this.deliveries.values()].filter(
          (delivery) => delivery.status === 'sent',
        ).length;
        raw.queue_locked_at = null;
      }
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('UPDATE broadcasts') &&
      sql.includes('SET batch_offset = ?')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      raw.batch_offset = bindings[0];
      this.broadcast.success_count += Number(bindings[1] ?? 0);
      if (
        sql.includes('queue_locked_at = NULL') ||
        (sql.includes('CASE WHEN') && bindings[2] === 1)
      ) {
        raw.queue_locked_at = null;
      } else if (sql.includes('CASE WHEN')) {
        raw.queue_locked_at = bindings[3];
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE broadcasts SET success_count')) {
      this.broadcast.success_count += Number(bindings[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE broadcasts SET total_count')) {
      this.broadcast.total_count = Number(bindings[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE broadcasts SET status')) {
      this.broadcast.status = bindings[0] as Broadcast['status'];
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class FakeLineClient {
  readonly sends: Array<{ to: string; retryKey: string | undefined }> = [];

  constructor(
    private readonly beforeSend?: (to: string) => void,
  ) {}

  async pushMessage(to: string, _messages: unknown[], retryKey?: string) {
    this.beforeSend?.(to);
    this.sends.push({ to, retryKey });
    return {};
  }

  async multicast(to: string[], _messages: unknown[], _units?: string[], retryKey?: string) {
    for (const lineUserId of to) this.sends.push({ to: lineUserId, retryKey });
    return { data: undefined, requestId: null };
  }
}

function asD1(db: FakeD1) {
  return db as unknown as D1Database;
}

function asLine(client: FakeLineClient) {
  return client as unknown as LineClient;
}

describe('broadcast delivery isolation and idempotency', () => {
  it('uses account-scoped production tag SQL and excludes another account', async () => {
    const broadcast = makeBroadcast();
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
      { id: 'friend-b', line_user_id: 'U-b', line_account_id: 'account-b', is_following: 1, tag_id: 'tag-1' },
    ]);
    const line = new FakeLineClient();

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    const audienceQuery = db.boundSql.find(({ sql }) =>
      sql.includes('FROM friends f') && sql.includes('friend_tags'),
    );
    expect(audienceQuery?.sql).toContain('f.line_account_id = ?');
    expect(audienceQuery?.bindings).toContain(ACCOUNT_A);
    expect(line.sends.map((send) => send.to)).toEqual(['U-a']);
  });

  it('groups OR segment rules under the LINE account predicate', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'OR',
        rules: [
          { type: 'tag_exists', value: 'tag-1' },
          { type: 'is_following', value: true },
        ],
      }),
    });
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
      { id: 'friend-b', line_user_id: 'U-b', line_account_id: 'account-b', is_following: 1, tag_id: 'tag-2' },
    ]);

    await processQueuedBroadcasts(asD1(db), asLine(new FakeLineClient()));

    const segmentQuery = db.boundSql.find(({ sql }) =>
      sql.includes('FROM friends f WHERE'),
    );
    expect(segmentQuery?.sql).toContain('WHERE f.line_account_id = ? AND (');
  });

  it('persists one delivery identity and a stable retry key before sending, then skips sent targets', async () => {
    const broadcast = makeBroadcast();
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    const line = new FakeLineClient();

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);
    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    expect(db.deliveries.size).toBe(1);
    expect([...db.deliveries.values()][0].retry_key).toMatch(RETRY_KEY_RE);
    expect([...db.deliveries.values()][0].status).toBe('sent');
    expect(line.sends).toHaveLength(1);
    expect(line.sends[0].retryKey).toBe([...db.deliveries.values()][0].retry_key);
  });

  it('recovers the acceptance crash window by reusing the persisted retry key', async () => {
    const broadcast = makeBroadcast();
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    const line = new FakeLineClient();
    db.failNextSentRecord = true;

    await expect(
      processBroadcastSend(asD1(db), asLine(line), broadcast.id),
    ).rejects.toThrow('simulated crash');
    expect([...db.deliveries.values()][0].status).toBe('uncertain');

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    expect(line.sends).toHaveLength(2);
    expect(line.sends[1].retryKey).toBe(line.sends[0].retryKey);
    expect([...db.deliveries.values()][0].status).toBe('sent');
  });

  it('does not advance queue offset until the per-target result is durable', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'tag_exists', value: 'tag-1' }],
      }),
    });
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    db.failNextSentRecord = true;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await processQueuedBroadcasts(asD1(db), asLine(new FakeLineClient()));
    } finally {
      consoleSpy.mockRestore();
    }

    expect((broadcast as unknown as Record<string, unknown>).batch_offset).toBe(0);
    expect([...db.deliveries.values()][0].status).toBe('uncertain');
    expect(broadcast.success_count).toBe(0);
  });

  it('keeps the queue lock while advancing durable per-target progress', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }],
      }),
    });
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
      { id: 'friend-b', line_user_id: 'U-b', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-2' },
    ]);
    let lockHeldBeforeSecondSend = false;
    const line = new FakeLineClient((to) => {
      const raw = broadcast as unknown as Record<string, unknown>;
      if (to === 'U-a') {
        raw.queue_locked_at = '2026-07-25T00:00:00.000Z';
        return;
      }
      if (to !== 'U-b') return;
      lockHeldBeforeSecondSend =
        typeof raw.queue_locked_at === 'string' &&
        raw.queue_locked_at !== '2026-07-25T00:00:00.000Z' &&
        raw.batch_offset === 1;
    });

    await processQueuedBroadcasts(asD1(db), asLine(line));

    expect(lockHeldBeforeSecondSend).toBe(true);
  });

  it('moves an uncertain delivery older than 24 hours to manual review without resending', async () => {
    const broadcast = makeBroadcast();
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    db.deliveries.set(`${broadcast.id}:friend-a`, {
      id: 'delivery-old',
      broadcast_id: broadcast.id,
      friend_id: 'friend-a',
      line_account_id: ACCOUNT_A,
      status: 'uncertain',
      attempt_count: 1,
      retry_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      retry_key_created_at: '2026-07-25T00:00:00.000Z',
      first_attempted_at: '2026-07-25T00:00:00.000Z',
      last_error: 'network response lost',
    });
    const line = new FakeLineClient();

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    expect(line.sends).toHaveLength(0);
    expect([...db.deliveries.values()][0].status).toBe('manual_review');
  });

  it('allows the first attempt after 24 hours when LINE has never seen the retry key', async () => {
    const broadcast = makeBroadcast();
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    db.deliveries.set(`${broadcast.id}:friend-a`, {
      id: 'delivery-pending',
      broadcast_id: broadcast.id,
      friend_id: 'friend-a',
      line_account_id: ACCOUNT_A,
      status: 'pending',
      attempt_count: 0,
      retry_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      retry_key_created_at: '2026-07-25T00:00:00.000Z',
      first_attempted_at: null,
      last_error: null,
    });
    const line = new FakeLineClient();

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    expect(line.sends).toHaveLength(1);
    expect([...db.deliveries.values()][0].status).toBe('sent');
  });

  it('recovers a stale queue lock after a partial delivery so restart can resume', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      success_count: 1,
      batch_offset: -1,
      queue_locked_at: '2026-07-25T00:00:00.000Z',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'tag_exists', value: 'tag-1' }],
      }),
    });
    const db = new FakeD1(broadcast, []);

    await recoverStalledBroadcasts(asD1(db));

    expect((broadcast as unknown as Record<string, unknown>).batch_offset).toBe(0);
    expect((broadcast as unknown as Record<string, unknown>).queue_locked_at).toBeNull();
  });
});
