import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jstNow,
  markBroadcastDeliverySent,
  recoverStalledBroadcasts,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import { LineApiError } from '@line-crm/line-sdk';
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
  claim_token?: string | null;
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
    queue_locked_at: null,
    queue_lease_token: null,
    audience_cursor: null,
    audience_materialized_at: null,
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

class SqliteStatement {
  bindings: unknown[] = [];

  constructor(readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }
}

class SqliteD1 {
  constructor(private readonly databasePath: string) {}

  prepare(sql: string) {
    return new SqliteStatement(sql);
  }

  async batch(statements: SqliteStatement[]) {
    const changes: number[] = [];
    const script = [
      'BEGIN IMMEDIATE',
      ...statements.map((statement) =>
        `${bindSql(statement.sql, statement.bindings)}; SELECT changes()`,
      ),
      'COMMIT',
    ].join(';\n');
    const output = sqliteScalar(this.databasePath, script);
    for (const line of output.split('\n').filter(Boolean)) {
      changes.push(Number(line));
    }
    return changes.map((count) => ({ meta: { changes: count } }));
  }
}

class FakeD1 {
  readonly boundSql: Array<{ sql: string; bindings: unknown[] }> = [];
  readonly deliveries = new Map<string, DeliveryRow>();
  readonly messageLog: string[] = [];
  private readonly loggedDeliveryIds = new Set<string>();
  failNextSentRecord = false;
  afterAudienceFetch?: () => void;

  constructor(
    readonly broadcast: Broadcast,
    readonly friends: FriendRow[],
  ) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    const deliverySnapshot = [...this.deliveries.entries()].map(
      ([key, value]) => [key, { ...value }] as const,
    );
    const messageLogSnapshot = [...this.messageLog];
    const loggedDeliverySnapshot = [...this.loggedDeliveryIds];
    const broadcastSnapshot = {
      ...(this.broadcast as unknown as Record<string, unknown>),
    };

    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.deliveries.clear();
      for (const [key, value] of deliverySnapshot) {
        this.deliveries.set(key, value);
      }
      this.messageLog.splice(0, this.messageLog.length, ...messageLogSnapshot);
      this.loggedDeliveryIds.clear();
      for (const id of loggedDeliverySnapshot) this.loggedDeliveryIds.add(id);
      Object.assign(this.broadcast, broadcastSnapshot);
      throw error;
    }
  }

  first(sql: string, bindings: unknown[]) {
    if (sql.includes('UPDATE broadcast_deliveries') && sql.includes('RETURNING *')) {
      const now = String(bindings[0]);
      const deliveryId = String(bindings.at(-2));
      const leaseToken = String(bindings.at(-1));
      const raw = this.broadcast as unknown as Record<string, unknown>;
      const delivery = [...this.deliveries.values()].find(
        (row) => row.id === deliveryId,
      );
      if (
        !delivery ||
        !['pending', 'uncertain'].includes(delivery.status) ||
        raw.queue_lease_token !== leaseToken
      ) {
        return null;
      }

      const ageMs = delivery.first_attempted_at
        ? new Date(now).getTime() -
          new Date(delivery.first_attempted_at).getTime()
        : 0;
      if (delivery.first_attempted_at && ageMs >= 24 * 60 * 60_000) {
        delivery.status = 'manual_review';
        delivery.claim_token = null;
        delivery.last_error =
          'LINE retry key expired after 24 hours; manual review required';
      } else {
        delivery.status = 'uncertain';
        delivery.attempt_count += 1;
        delivery.first_attempted_at ??= now;
        delivery.claim_token = leaseToken;
      }
      return {
        ...delivery,
        line_user_id: this.friends.find(
          (friend) => friend.id === delivery.friend_id,
        )?.line_user_id,
      };
    }
    if (sql.includes('FROM broadcasts b')) return this.broadcast;
    if (sql.includes('FROM line_accounts')) return null;
    if (sql.includes('COUNT(*)') && sql.includes('broadcast_deliveries')) {
      const rows = [...this.deliveries.values()].filter((d) => d.broadcast_id === bindings[0]);
      return {
        total_count: rows.length,
        sent_count: rows.filter((d) => d.status === 'sent').length,
        manual_review_count: rows.filter((d) => d.status === 'manual_review').length,
        failed_count: rows.filter((d) => d.status === 'failed').length,
        remaining_count: rows.filter((d) =>
          ['pending', 'uncertain'].includes(d.status),
        ).length,
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
      return raw.queue_locked_at || raw.queue_lease_token
        ? []
        : [this.broadcast];
    }
    if (sql.includes('FROM friends f') && sql.includes('friend_tags')) {
      const [accountId, tagId] = sql.indexOf('f.line_account_id = ?') < sql.indexOf('ft.tag_id = ?')
        ? bindings
        : [bindings[1], bindings[0]];
      const cursor = String(bindings.at(-2) ?? '');
      const limit = Number(bindings.at(-1) ?? 25);
      const rows = this.friends.filter(
        (f) =>
          f.line_account_id === accountId &&
          f.tag_id === tagId &&
          f.is_following === 1 &&
          f.id > cursor,
      ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      this.afterAudienceFetch?.();
      this.afterAudienceFetch = undefined;
      return rows;
    }
    if (sql.includes('FROM friends f WHERE')) {
      const accountId = bindings[0];
      const cursor = String(bindings.at(-2) ?? '');
      const limit = Number(bindings.at(-1) ?? 25);
      const rows = this.friends.filter(
        (f) =>
          f.line_account_id === accountId &&
          f.is_following === 1 &&
          f.id > cursor,
      ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      this.afterAudienceFetch?.();
      this.afterAudienceFetch = undefined;
      return rows;
    }
    if (sql.includes('FROM broadcast_deliveries')) {
      const limit = Number(bindings.at(-1) ?? 8);
      return [...this.deliveries.values()]
        .filter((d) => d.broadcast_id === bindings[0])
        .filter((d) => d.line_account_id === bindings[1])
        .filter((d) => ['pending', 'uncertain'].includes(d.status))
        .map((d) => ({
          ...d,
          line_user_id: this.friends.find((f) => f.id === d.friend_id)?.line_user_id,
        }))
        .slice(0, limit);
    }
    return [];
  }

  run(sql: string, bindings: unknown[]) {
    if (sql.includes('INSERT INTO broadcast_deliveries')) {
      const fenced = sql.includes('FROM broadcasts b');
      const deliveryBindings = (
        fenced
          ? [
              bindings[0],
              bindings[7],
              bindings[1],
              bindings[2],
              bindings[3],
              bindings[4],
            ]
          : bindings.slice(0, 6)
      ).map(String);
      const [
        id,
        broadcastId,
        friendId,
        accountId,
        retryKey,
        retryKeyCreatedAt,
      ] = deliveryBindings;
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        fenced &&
        (
          raw.id !== broadcastId ||
          raw.line_account_id !== bindings[8] ||
          raw.queue_lease_token !== bindings[9]
        )
      ) return { meta: { changes: 0 } };
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
          claim_token: null,
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'sent'") && sql.includes('broadcast_deliveries')) {
      const delivery = [...this.deliveries.values()].find(
        (row) => row.id === bindings[2],
      );
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        !delivery ||
        delivery.claim_token !== bindings[3] ||
        raw.queue_lease_token !== bindings[4]
      ) return { meta: { changes: 0 } };
      if (this.failNextSentRecord) {
        this.failNextSentRecord = false;
        throw new Error('simulated crash after LINE acceptance');
      }
      delivery.status = 'sent';
      delivery.last_error = null;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'failed'") && sql.includes('broadcast_deliveries')) {
      const delivery = [...this.deliveries.values()].find(
        (row) => row.id === bindings[2],
      );
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        !delivery ||
        delivery.claim_token !== bindings[3] ||
        raw.queue_lease_token !== bindings[4]
      ) return { meta: { changes: 0 } };
      delivery.status = 'failed';
      delivery.last_error = String(bindings[0]);
      delivery.claim_token = null;
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('UPDATE broadcast_deliveries') &&
      sql.includes('SET last_error = ?')
    ) {
      const delivery = [...this.deliveries.values()].find(
        (row) => row.id === bindings[2],
      );
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        !delivery ||
        delivery.claim_token !== bindings[3] ||
        raw.queue_lease_token !== bindings[4]
      ) return { meta: { changes: 0 } };
      delivery.last_error = String(bindings[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO messages_log')) {
      const deliveryId = String(bindings[5]);
      const delivery = [...this.deliveries.values()].find(
        (row) => row.id === deliveryId,
      );
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        !delivery ||
        delivery.status !== 'sent' ||
        delivery.claim_token !== bindings[8] ||
        raw.queue_lease_token !== bindings[9] ||
        this.loggedDeliveryIds.has(deliveryId)
      ) return { meta: { changes: 0 } };
      this.loggedDeliveryIds.add(deliveryId);
      this.messageLog.push(String(bindings[1]));
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('SET queue_locked_at = ?, queue_lease_token = ?') &&
      sql.includes('queue_locked_at IS NULL')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (raw.batch_offset !== bindings[3]) return { meta: { changes: 0 } };
      if (raw.queue_locked_at || raw.queue_lease_token) {
        return { meta: { changes: 0 } };
      }
      raw.queue_locked_at = bindings[0];
      raw.queue_lease_token = bindings[1];
      return { meta: { changes: 1 } };
    }
    if (sql.includes('SET audience_cursor = ?')) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (
        raw.line_account_id !== bindings[4] ||
        raw.queue_lease_token !== bindings[5]
      ) {
        return { meta: { changes: 0 } };
      }
      raw.audience_cursor = bindings[0];
      raw.audience_materialized_at = bindings[1] === 1 ? bindings[2] : null;
      this.broadcast.total_count = [...this.deliveries.values()].filter(
        (delivery) => delivery.broadcast_id === this.broadcast.id,
      ).length;
      raw.queue_locked_at = null;
      raw.queue_lease_token = null;
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
        raw.queue_lease_token = null;
      }
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes('UPDATE broadcasts') &&
      sql.includes('SET batch_offset = (')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      if (raw.queue_lease_token !== bindings[4]) {
        return { meta: { changes: 0 } };
      }
      raw.batch_offset = [...this.deliveries.values()].filter((delivery) =>
        ['sent', 'failed', 'manual_review'].includes(delivery.status),
      ).length;
      this.broadcast.success_count = [...this.deliveries.values()].filter(
        (delivery) => delivery.status === 'sent',
      ).length;
      if (bindings[0] === 1) {
        raw.queue_locked_at = null;
        raw.queue_lease_token = null;
      } else {
        raw.queue_locked_at = bindings[1];
      }
      return { meta: { changes: 1 } };
    }
    if (
      sql.includes("SET status = 'sent',") &&
      sql.includes('audience_materialized_at IS NOT NULL')
    ) {
      const raw = this.broadcast as unknown as Record<string, unknown>;
      const remaining = [...this.deliveries.values()].some((delivery) =>
        ['pending', 'uncertain'].includes(delivery.status),
      );
      if (
        raw.queue_lease_token !== bindings[3] ||
        !raw.audience_materialized_at ||
        remaining
      ) return { meta: { changes: 0 } };
      this.broadcast.status = 'sent';
      this.broadcast.sent_at = String(bindings[0]);
      this.broadcast.total_count = this.deliveries.size;
      this.broadcast.success_count = [...this.deliveries.values()].filter(
        (delivery) => delivery.status === 'sent',
      ).length;
      raw.batch_offset = [...this.deliveries.values()].filter((delivery) =>
        ['sent', 'failed', 'manual_review'].includes(delivery.status),
      ).length;
      raw.queue_locked_at = null;
      raw.queue_lease_token = null;
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
  broadcastCalls = 0;

  constructor(
    private readonly beforeSend?: (to: string) => void | Promise<void>,
  ) {}

  async pushMessage(to: string, _messages: unknown[], retryKey?: string) {
    await this.beforeSend?.(to);
    this.sends.push({ to, retryKey });
    return {};
  }

  async multicast(to: string[], _messages: unknown[], _units?: string[], retryKey?: string) {
    for (const lineUserId of to) this.sends.push({ to: lineUserId, retryKey });
    return { data: undefined, requestId: null };
  }

  async broadcast() {
    this.broadcastCalls += 1;
    return { data: undefined, requestId: 'all-request-id' };
  }
}

function asD1(db: FakeD1) {
  return db as unknown as D1Database;
}

function asLine(client: FakeLineClient) {
  return client as unknown as LineClient;
}

async function processMaterializedQueue(db: FakeD1, line: FakeLineClient) {
  await processQueuedBroadcasts(asD1(db), asLine(line));
  await processQueuedBroadcasts(asD1(db), asLine(line));
}

function sqliteScalar(databasePath: string, sql: string): string {
  return execFileSync('sqlite3', [databasePath, sql], {
    encoding: 'utf8',
  }).trim();
}

function bindSql(sql: string, bindings: unknown[]): string {
  let index = 0;
  const bound = sql.replace(/\?/g, () => {
    if (index >= bindings.length) throw new Error('Missing SQLite binding');
    return sqliteLiteral(bindings[index++]);
  });
  if (index !== bindings.length) throw new Error('Unused SQLite binding');
  return bound;
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('broadcast delivery isolation and idempotency', () => {
  it('executes the production sent and message-log SQL against the shipped schema', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'broadcast-sent-sql-'));
    const databasePath = join(directory, 'sent.sqlite');
    try {
      const schemaPath = join(
        process.cwd(),
        '../../packages/db/schema.sql',
      );
      execFileSync('sqlite3', [databasePath, `.read ${schemaPath}`]);
      sqliteScalar(
        databasePath,
        `INSERT INTO friends (id, line_user_id) VALUES ('friend-sql', 'U-sql');
         INSERT INTO broadcasts
           (id, title, message_type, message_content, target_type, status,
            line_account_id, queue_locked_at, queue_lease_token)
         VALUES
           ('broadcast-sql', 'SQL broadcast', 'text', 'hello', 'tag',
            'sending', '${ACCOUNT_A}', '${jstNow()}', 'lease-sql');
         INSERT INTO broadcast_deliveries
           (id, broadcast_id, friend_id, line_account_id, status,
            attempt_count, retry_key, retry_key_created_at, first_attempted_at,
            claim_token, created_at, updated_at)
         VALUES
           ('delivery-sql', 'broadcast-sql', 'friend-sql', '${ACCOUNT_A}',
            'uncertain', 1, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            '${jstNow()}', '${jstNow()}', 'lease-sql', '${jstNow()}',
            '${jstNow()}');`,
      );
      const broadcast = makeBroadcast({
        id: 'broadcast-sql',
        message_content: 'hello',
        queue_lease_token: 'lease-sql',
      });
      const delivery = {
        id: 'delivery-sql',
        broadcast_id: 'broadcast-sql',
        friend_id: 'friend-sql',
        line_account_id: ACCOUNT_A,
        line_user_id: 'U-sql',
        status: 'uncertain' as const,
        attempt_count: 1,
        retry_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        retry_key_created_at: jstNow(),
        first_attempted_at: jstNow(),
        last_error: null,
        claim_token: 'lease-sql',
      };
      const sqliteDb = new SqliteD1(databasePath) as unknown as D1Database;

      await expect(
        markBroadcastDeliverySent(
          sqliteDb,
          delivery,
          broadcast,
          'lease-sql',
          jstNow(),
        ),
      ).resolves.toBe(true);
      await expect(
        markBroadcastDeliverySent(
          sqliteDb,
          delivery,
          broadcast,
          'lease-sql',
          jstNow(),
        ),
      ).resolves.toBe(true);

      expect(
        sqliteScalar(
          databasePath,
          `SELECT
             (SELECT status FROM broadcast_deliveries
              WHERE id = 'delivery-sql') || ':' ||
             (SELECT COUNT(*) FROM messages_log
              WHERE broadcast_delivery_id = 'delivery-sql')`,
        ),
      ).toBe('sent:1');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps a fresh +09:00 queue lease when SQLite compares it with UTC now', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'broadcast-lease-'));
    const databasePath = join(directory, 'lease.sqlite');
    try {
      sqliteScalar(
        databasePath,
        `CREATE TABLE broadcasts (
           id TEXT PRIMARY KEY,
           status TEXT NOT NULL,
           sent_at TEXT,
           segment_conditions TEXT,
           batch_offset INTEGER NOT NULL,
           success_count INTEGER NOT NULL,
           queue_locked_at TEXT,
           queue_lease_token TEXT
         );
         CREATE TABLE broadcast_deliveries (
           broadcast_id TEXT NOT NULL,
           status TEXT NOT NULL
         );
         INSERT INTO broadcasts
           (id, status, sent_at, segment_conditions, batch_offset,
            success_count, queue_locked_at)
         VALUES
           ('broadcast-fresh', 'sending', NULL, '{}', 0, 0, '${jstNow()}');`,
      );
      const sqliteDb = {
        prepare(sql: string) {
          return {
            async run() {
              sqliteScalar(databasePath, sql);
              return { meta: { changes: 0 } };
            },
          };
        },
      } as unknown as D1Database;

      await recoverStalledBroadcasts(sqliteDb);

      expect(
        sqliteScalar(
          databasePath,
          `SELECT queue_locked_at IS NOT NULL
           FROM broadcasts WHERE id = 'broadcast-fresh'`,
        ),
      ).toBe('1');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
      await processMaterializedQueue(db, new FakeLineClient());
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

    await processMaterializedQueue(db, line);

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

  it('marks an ordinary LINE 4xx terminal and continues later targets', async () => {
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
    const line = new FakeLineClient((to) => {
      if (to === 'U-a') throw new LineApiError(400, 'request-id');
    });

    await processMaterializedQueue(db, line);

    expect([...db.deliveries.values()].find((d) => d.friend_id === 'friend-a')?.status).toBe('failed');
    expect([...db.deliveries.values()].find((d) => d.friend_id === 'friend-b')?.status).toBe('sent');
    expect(line.sends.map((send) => send.to)).toEqual(['U-b']);
  });

  it('keeps retryable LINE failures uncertain and stops the invocation', async () => {
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
    const line = new FakeLineClient((to) => {
      if (to === 'U-a') throw new LineApiError(503, 'request-id');
    });

    await processMaterializedQueue(db, line);

    expect([...db.deliveries.values()].find((d) => d.friend_id === 'friend-a')?.status).toBe('uncertain');
    expect([...db.deliveries.values()].find((d) => d.friend_id === 'friend-b')?.status).toBe('pending');
    expect(line.sends).toHaveLength(0);
  });

  it('rechecks the 24-hour boundary atomically immediately before each send', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'));
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }],
      }),
    });
    const friends: FriendRow[] = [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
      { id: 'friend-b', line_user_id: 'U-b', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-2' },
    ];
    const db = new FakeD1(broadcast, friends);
    for (const friend of friends) {
      db.deliveries.set(`${broadcast.id}:${friend.id}`, {
        id: `delivery-${friend.id}`,
        broadcast_id: broadcast.id,
        friend_id: friend.id,
        line_account_id: ACCOUNT_A,
        status: 'uncertain',
        attempt_count: 1,
        retry_key: crypto.randomUUID(),
        retry_key_created_at: '2026-07-26T00:01:00.000Z',
        first_attempted_at: '2026-07-26T00:01:00.000Z',
        last_error: null,
      });
    }
    const line = new FakeLineClient((to) => {
      if (to === 'U-a') {
        vi.setSystemTime(new Date('2026-07-27T00:02:00.000Z'));
      }
    });

    await processMaterializedQueue(db, line);

    expect(line.sends.map((send) => send.to)).toEqual(['U-a']);
    expect(db.deliveries.get(`${broadcast.id}:friend-b`)?.status).toBe('manual_review');
  });

  it('fences an old Worker after lease recovery and writes one sent log', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }],
      }),
    });
    const db = new FakeD1(broadcast, [
      { id: 'friend-a', line_user_id: 'U-a', line_account_id: ACCOUNT_A, is_following: 1, tag_id: 'tag-1' },
    ]);
    const secondLine = new FakeLineClient();
    let recovered = false;
    const firstLine = new FakeLineClient(async () => {
      if (recovered) return;
      recovered = true;
      const raw = broadcast as unknown as Record<string, unknown>;
      raw.queue_locked_at = null;
      raw.queue_lease_token = null;
      await processQueuedBroadcasts(asD1(db), asLine(secondLine));
    });

    await processMaterializedQueue(db, firstLine);

    expect(firstLine.sends).toHaveLength(1);
    expect(secondLine.sends).toHaveLength(1);
    expect(db.messageLog).toEqual(['friend-a']);
    expect(broadcast.success_count).toBe(1);
  });

  it.each([
    { transition: 'lease recovery', completed: false },
    { transition: 'queue completion', completed: true },
  ])('does not materialize or advance the cursor after $transition', async ({ completed }) => {
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
    db.afterAudienceFetch = () => {
      const raw = broadcast as unknown as Record<string, unknown>;
      if (completed) {
        raw.status = 'sent';
        raw.sent_at = jstNow();
        raw.queue_locked_at = null;
        raw.queue_lease_token = null;
      } else {
        raw.queue_locked_at = jstNow();
        raw.queue_lease_token = 'replacement-owner';
      }
    };

    await processQueuedBroadcasts(asD1(db), asLine(new FakeLineClient()));

    expect(db.deliveries.size).toBe(0);
    expect(broadcast.audience_cursor).toBeNull();
    expect(broadcast.audience_materialized_at).toBeNull();
    expect(broadcast.queue_lease_token).toBe(
      completed ? null : 'replacement-owner',
    );
  });

  it('materializes a large audience once in a bounded invocation before sending', async () => {
    const broadcast = makeBroadcast({
      status: 'sending',
      segment_conditions: JSON.stringify({
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }],
      }),
    });
    const friends = Array.from({ length: 60 }, (_, index) => ({
      id: `friend-${String(index).padStart(3, '0')}`,
      line_user_id: `U-${index}`,
      line_account_id: ACCOUNT_A,
      is_following: 1,
      tag_id: 'tag-1',
    }));
    const db = new FakeD1(broadcast, friends);
    const line = new FakeLineClient();

    await processQueuedBroadcasts(asD1(db), asLine(line));

    expect(db.deliveries.size).toBeGreaterThan(0);
    expect(db.deliveries.size).toBeLessThanOrEqual(25);
    expect(db.boundSql.length).toBeLessThanOrEqual(35);
    expect(line.sends).toHaveLength(0);
    expect(broadcast.status).toBe('sending');

    let previousQueryCount = db.boundSql.length;
    await processQueuedBroadcasts(asD1(db), asLine(line));
    expect(db.deliveries.size).toBe(50);
    expect(db.boundSql.length - previousQueryCount).toBeLessThanOrEqual(35);
    expect(line.sends).toHaveLength(0);

    previousQueryCount = db.boundSql.length;
    await processQueuedBroadcasts(asD1(db), asLine(line));
    expect(db.deliveries.size).toBe(60);
    expect(db.boundSql.length - previousQueryCount).toBeLessThanOrEqual(35);
    expect(line.sends).toHaveLength(0);

    previousQueryCount = db.boundSql.length;
    await processQueuedBroadcasts(asD1(db), asLine(line));
    expect(line.sends).toHaveLength(8);
    expect(db.boundSql.length - previousQueryCount).toBeLessThanOrEqual(45);
  });

  it('keeps all-audience delivery on the LINE broadcast API', async () => {
    const broadcast = makeBroadcast({
      target_type: 'all',
      target_tag_id: null,
      line_account_id: null,
    });
    const db = new FakeD1(broadcast, []);
    const line = new FakeLineClient();

    await processBroadcastSend(asD1(db), asLine(line), broadcast.id);

    expect(line.broadcastCalls).toBe(1);
    expect(line.sends).toHaveLength(0);
    expect(db.deliveries.size).toBe(0);
  });
});
