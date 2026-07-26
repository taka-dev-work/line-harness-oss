import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { buildPublicFormSubmissionContext } from '../services/line-id-token.js';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  addTagToFriend: vi.fn(),
  createForm: vi.fn(),
  createFormSubmission: vi.fn(),
  deleteForm: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFormById: vi.fn(),
  getFormSubmissions: vi.fn(),
  getForms: vi.fn(),
  getFriendById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getLineAccountById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  jstNow: vi.fn(() => '2026-07-27T00:00:00+09:00'),
  updateForm: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { forms } from './forms.js';

const trustedFriend = {
  id: 'friend-verified',
  line_user_id: 'U-verified',
  display_name: 'Verified friend',
  metadata: '{}',
  first_tracked_link_id: null,
  user_id: null,
  line_account_id: null,
};

const form = {
  id: 'form-1',
  name: 'Security form',
  description: null,
  fields: JSON.stringify([{ name: 'answer', label: 'Answer', type: 'text', required: true }]),
  on_submit_tag_id: 'tag-1',
  on_submit_scenario_id: 'scenario-1',
  on_submit_message_type: 'text',
  on_submit_message_content: 'Thanks',
  on_submit_webhook_url: 'https://webhook.example.test/forms',
  on_submit_webhook_headers: null,
  on_submit_webhook_fail_message: null,
  save_to_metadata: 1,
  is_active: 1,
  submit_count: 0,
  created_at: '2026-07-27T00:00:00+09:00',
  updated_at: '2026-07-27T00:00:00+09:00',
};

const dbRuns: Array<{ statement: string; values: unknown[] }> = [];
const fakeDb = {
  prepare(statement: string) {
    return {
      bind(...values: unknown[]) {
        return {
          async run() {
            dbRuns.push({ statement, values });
            return { success: true };
          },
        };
      },
    };
  },
};

const env = {
  DB: fakeDb,
  LINE_CHANNEL_ACCESS_TOKEN: 'channel-access-token',
  LINE_LOGIN_CHANNEL_ID: 'login-channel-id',
} as Env['Bindings'];

function setupApp() {
  const app = new Hono<Env>();
  app.route('/', forms);
  return app;
}

function request(path: string, body: Record<string, unknown>, idToken?: string) {
  return setupApp().request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  }, env);
}

function responseFor(url: string): Response {
  if (url === 'https://api.line.me/oauth2/v2.1/verify') {
    return new Response(JSON.stringify({ sub: 'U-verified' }), { status: 200 });
  }
  if (url === form.on_submit_webhook_url) {
    return new Response(JSON.stringify({ eligible: true }), { status: 200 });
  }
  if (url === 'https://api.line.me/v2/bot/message/push') {
    return new Response('', { status: 200 });
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

beforeEach(() => {
  dbRuns.length = 0;
  vi.clearAllMocks();
  dbMocks.getFormById.mockResolvedValue(form);
  dbMocks.getFriendByLineUserId.mockResolvedValue(null);
  dbMocks.getFriendById.mockResolvedValue(trustedFriend);
  dbMocks.createFormSubmission.mockImplementation(async (_db: unknown, input: { formId: string; friendId?: string | null; data: string }) => ({
    id: 'submission-1',
    form_id: input.formId,
    friend_id: input.friendId ?? null,
    data: input.data,
    created_at: '2026-07-27T00:00:00+09:00',
  }));
  dbMocks.addTagToFriend.mockResolvedValue(undefined);
  dbMocks.enrollFriendInScenario.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => responseFor(String(input))));
});

describe('public form submission security boundary', () => {
  test('removes public control fields and always validates a configured webhook', () => {
    const result = buildPublicFormSubmissionContext({
      friendId: 'victim-friend',
      lineUserId: 'U-victim',
      _skipWebhook: true,
      data: {
        answer: 'yes',
        friendId: 'victim-friend',
        lineUserId: 'U-victim',
        _skipWebhook: true,
      },
    }, null);

    expect(result.data).toEqual({ answer: 'yes' });
    expect(result.shouldValidateWebhook).toBe(true);
  });

  test('does not accept a submitted friendId as identity', () => {
    const result = buildPublicFormSubmissionContext({ friendId: 'victim-friend' }, null);

    expect(result.friendId).toBeNull();
    expect(result.allowSideEffects).toBe(false);
  });

  test('does not accept a submitted lineUserId without verified LIFF identity', () => {
    const result = buildPublicFormSubmissionContext({ lineUserId: 'U-victim' }, null);

    expect(result.lineUserId).toBeNull();
    expect(result.friendId).toBeNull();
  });

  test('uses a verified LIFF token subject as the only trusted LINE user ID', () => {
    const result = buildPublicFormSubmissionContext({ lineUserId: 'U-verified' }, 'U-verified', {
      trustedFriendId: 'friend-verified',
    });

    expect(result.rejected).toBe(false);
    expect(result.lineUserId).toBe('U-verified');
    expect(result.friendId).toBe('friend-verified');
    expect(result.allowSideEffects).toBe(true);
  });

  test('rejects a public lineUserId that disagrees with a verified LIFF token subject', () => {
    const result = buildPublicFormSubmissionContext({ lineUserId: 'U-attacker' }, 'U-verified');

    expect(result.rejected).toBe(true);
  });

  test('keeps unverified submissions anonymous and blocks every friend automation', () => {
    const result = buildPublicFormSubmissionContext({ data: { answer: 'anonymous' } }, null);

    expect(result.friendId).toBeNull();
    expect(result.data).toEqual({ answer: 'anonymous' });
    expect(result.sideEffects).toEqual({
      addTags: false,
      enrollScenarios: false,
      updateMetadata: false,
      sendReply: false,
      issueAffiliateReward: false,
    });
  });

  test('allows a server-only trusted friend input for verified automations', () => {
    const result = buildPublicFormSubmissionContext({}, 'U-verified', {
      trustedFriendId: 'friend-verified',
    });

    expect(result.friendId).toBe('friend-verified');
    expect(result.allowSideEffects).toBe(true);
  });
});

describe('public form routes', () => {
  test('opened ignores spoofed public identity', async () => {
    const response = await request('/api/forms/form-1/opened', {
      friendId: 'friend-victim',
      lineUserId: 'U-victim',
    });

    expect(response.status).toBe(200);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    expect(dbRuns).toEqual([expect.objectContaining({ values: expect.arrayContaining([null, null]) })]);
  });

  test('partial ignores spoofed identity and cannot update metadata', async () => {
    const response = await request('/api/forms/form-1/partial', {
      friendId: 'friend-victim',
      lineUserId: 'U-victim',
      data: { answer: 'attempted takeover' },
    });

    expect(response.status).toBe(404);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    expect(dbRuns).toEqual([]);
  });

  test('submit stores anonymous data, ignores public controls, and still validates the webhook', async () => {
    const response = await request('/api/forms/form-1/submit', {
      friendId: 'friend-victim',
      lineUserId: 'U-victim',
      _skipWebhook: true,
      data: {
        answer: 'anonymous answer',
        friendId: 'friend-victim',
        lineUserId: 'U-victim',
        _skipWebhook: true,
      },
    });

    expect(response.status).toBe(201);
    expect(dbMocks.createFormSubmission).toHaveBeenCalledWith(fakeDb, {
      formId: 'form-1',
      friendId: null,
      data: JSON.stringify({ answer: 'anonymous answer' }),
    });
    expect(fetch).toHaveBeenCalledWith(form.on_submit_webhook_url, expect.objectContaining({ method: 'POST' }));
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    expect(dbMocks.addTagToFriend).not.toHaveBeenCalled();
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(dbMocks.getTrackedLinkById).not.toHaveBeenCalled();
    expect(dbRuns).toEqual([]);
  });

  test('verified token resolves its friend and runs the trusted automation path', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(trustedFriend);

    const response = await request('/api/forms/form-1/submit', {
      friendId: 'friend-victim',
      lineUserId: 'U-verified',
      _skipWebhook: true,
      data: { answer: 'verified answer' },
    }, 'verified-id-token');

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.line.me/oauth2/v2.1/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: 'verified-id-token', client_id: 'login-channel-id' }),
      }),
    );
    expect(dbMocks.getFriendByLineUserId).toHaveBeenCalledWith(fakeDb, 'U-verified');
    expect(dbMocks.createFormSubmission).toHaveBeenCalledWith(fakeDb, {
      formId: 'form-1',
      friendId: 'friend-verified',
      data: JSON.stringify({ answer: 'verified answer' }),
    });
    expect(dbMocks.addTagToFriend).toHaveBeenCalledWith(fakeDb, 'friend-verified', 'tag-1');
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(fakeDb, 'friend-verified', 'scenario-1');
    expect(fetch).toHaveBeenCalledWith('https://api.line.me/v2/bot/message/push', expect.any(Object));
    expect(dbRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: expect.stringContaining('UPDATE friends SET metadata'), values: expect.arrayContaining(['friend-verified']) }),
      expect.objectContaining({ statement: expect.stringContaining('INSERT INTO messages_log'), values: expect.arrayContaining(['friend-verified']) }),
    ]));
  });
});
