import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  createIncomingWebhook: vi.fn(),
  createOutgoingWebhook: vi.fn(),
  createStripeEvent: vi.fn(),
  deleteIncomingWebhook: vi.fn(),
  deleteOutgoingWebhook: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getIncomingWebhookById: vi.fn(),
  getIncomingWebhooks: vi.fn(),
  getOutgoingWebhookById: vi.fn(),
  getOutgoingWebhooks: vi.fn(),
  getStripeEventByStripeId: vi.fn(),
  jstNow: vi.fn(),
  updateIncomingWebhook: vi.fn(),
  updateOutgoingWebhook: vi.fn(),
}));

const eventBusMocks = vi.hoisted(() => ({ fireEvent: vi.fn() }));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/event-bus.js', () => eventBusMocks);

import { meetCallback } from './meet-callback.js';
import { stripe } from './stripe.js';
import { webhooks } from './webhooks.js';

const fakeDb = {} as D1Database;
const baseEnv = { DB: fakeDb } as Env['Bindings'];

function request(route: Hono<Env>, path: string, init: RequestInit, env: Env['Bindings'] = baseEnv) {
  const app = new Hono<Env>();
  app.route('/', route);
  return app.request(path, init, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getIncomingWebhookById.mockResolvedValue({
    id: 'incoming-1',
    name: 'Partner callback',
    source_type: 'partner',
    secret: 'incoming-secret',
    is_active: 1,
  });
  dbMocks.getIncomingWebhooks.mockResolvedValue([]);
  dbMocks.getOutgoingWebhooks.mockResolvedValue([]);
  dbMocks.getStripeEventByStripeId.mockResolvedValue(null);
  dbMocks.createStripeEvent.mockResolvedValue({
    id: 'stripe-event-1',
    stripe_event_id: 'evt_1',
    event_type: 'payment_intent.succeeded',
    processed_at: '2026-07-27T00:00:00+09:00',
  });
});

describe('external webhook authentication', () => {
  test.each([
    ['missing signature', undefined],
    ['wrong signature', 'wrong-secret'],
  ])('incoming webhook rejects %s before fireEvent', async (_name, signature) => {
    const response = await request(webhooks, '/api/webhooks/incoming/incoming-1/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Webhook-Secret': signature } : {}),
      },
      body: JSON.stringify({ event: 'created' }),
    });

    expect(response.status).toBe(401);
    expect(eventBusMocks.fireEvent).not.toHaveBeenCalled();
  });

  test.each([
    ['missing secret', undefined],
    ['wrong secret', 'wrong-secret'],
  ])('Meet callback rejects %s', async (_name, secret) => {
    const response = await request(meetCallback, '/api/meet-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Meet-Callback-Secret': secret } : {}),
      },
      body: JSON.stringify({ line_user_id: 'U1', transcripts: [] }),
    }, { ...baseEnv, MEET_CALLBACK_SECRET: 'meet-secret' });

    expect(response.status).toBe(401);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
  });

  test('Meet callback returns 503 without its server secret', async () => {
    const response = await request(meetCallback, '/api/meet-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_user_id: 'U1', transcripts: [] }),
    });

    expect(response.status).toBe(503);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
  });

  test('Stripe endpoint returns 503 without its server secret', async () => {
    const response = await request(stripe, '/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } }),
    });

    expect(response.status).toBe(503);
    expect(dbMocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test('Stripe endpoint rejects an invalid signature', async () => {
    const response = await request(stripe, '/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=123,v1=invalid-signature',
      },
      body: JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } }),
    }, { ...baseEnv, STRIPE_WEBHOOK_SECRET: 'stripe-secret' });

    expect(response.status).toBe(401);
    expect(dbMocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test('webhook management list responses expose only hasSecret', async () => {
    dbMocks.getIncomingWebhooks.mockResolvedValue([{
      id: 'incoming-1', name: 'Incoming', source_type: 'partner', secret: 'incoming-secret', is_active: 1, created_at: 'now', updated_at: 'now',
    }]);
    dbMocks.getOutgoingWebhooks.mockResolvedValue([{
      id: 'outgoing-1', name: 'Outgoing', url: 'https://example.test', event_types: '[]', secret: 'outgoing-secret', is_active: 1, created_at: 'now', updated_at: 'now',
    }]);

    const [incoming, outgoing] = await Promise.all([
      request(webhooks, '/api/webhooks/incoming', { method: 'GET' }),
      request(webhooks, '/api/webhooks/outgoing', { method: 'GET' }),
    ]);

    const [incomingBody, outgoingBody] = await Promise.all([incoming.json(), outgoing.json()]);

    expect(incomingBody).toMatchObject({ data: [{ hasSecret: true }] });
    expect(outgoingBody).toMatchObject({ data: [{ hasSecret: true }] });
    expect(incomingBody).not.toHaveProperty('data.0.secret');
    expect(outgoingBody).not.toHaveProperty('data.0.secret');
  });
});
