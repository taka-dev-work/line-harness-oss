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

async function stripeSignature(secret: string, timestamp: string | number, rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const value = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `t=${timestamp},v1=${value}`;
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
  dbMocks.getOutgoingWebhookById.mockResolvedValue({
    id: 'outgoing-1',
    name: 'Partner notification',
    url: 'https://example.test/webhook',
    event_types: '["friend_add"]',
    secret: 'outgoing-secret',
    is_active: 1,
    created_at: 'now',
    updated_at: 'now',
  });
  dbMocks.createIncomingWebhook.mockResolvedValue({
    id: 'incoming-1',
    name: 'Partner callback',
    source_type: 'partner',
    secret: 'incoming-secret',
    is_active: 1,
    created_at: 'now',
    updated_at: 'now',
  });
  dbMocks.createOutgoingWebhook.mockResolvedValue({
    id: 'outgoing-1',
    name: 'Partner notification',
    url: 'https://example.test/webhook',
    event_types: '["friend_add"]',
    secret: 'outgoing-secret',
    is_active: 1,
    created_at: 'now',
    updated_at: 'now',
  });
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

  test('incoming webhook rejects malformed JSON before parsing when unauthenticated', async () => {
    const response = await request(webhooks, '/api/webhooks/incoming/incoming-1/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(401);
    expect(eventBusMocks.fireEvent).not.toHaveBeenCalled();
  });

  test('incoming webhook returns 503 without a stored secret before fireEvent', async () => {
    dbMocks.getIncomingWebhookById.mockResolvedValue({
      id: 'incoming-1',
      name: 'Partner callback',
      source_type: 'partner',
      secret: null,
      is_active: 1,
    });

    const response = await request(webhooks, '/api/webhooks/incoming/incoming-1/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'ignored' },
      body: '{',
    });

    expect(response.status).toBe(503);
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

  test('Meet callback rejects malformed JSON before parsing when unauthenticated', async () => {
    const response = await request(meetCallback, '/api/meet-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
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

  test('Stripe endpoint rejects malformed JSON before parsing when unauthenticated', async () => {
    const response = await request(stripe, '/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1700000000,v1=invalid-signature',
      },
      body: '{',
    }, { ...baseEnv, STRIPE_WEBHOOK_SECRET: 'stripe-secret' });

    expect(response.status).toBe(401);
    expect(dbMocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test('Stripe endpoint rejects a valid signature with a malformed timestamp before side effects', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } });
    const response = await request(stripe, '/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': await stripeSignature('stripe-secret', 'not-a-timestamp', body),
      },
      body,
    }, { ...baseEnv, STRIPE_WEBHOOK_SECRET: 'stripe-secret' });

    expect(response.status).toBe(401);
    expect(dbMocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test.each([
    ['stale', -301],
    ['future', 301],
  ])('Stripe endpoint rejects a valid but %s signature before side effects', async (_name, offsetSeconds) => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000) + offsetSeconds;
    const response = await request(stripe, '/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': await stripeSignature('stripe-secret', timestamp, body),
      },
      body,
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

  test('incoming webhook create and update responses expose only hasSecret', async () => {
    const [created, updated] = await Promise.all([
      request(webhooks, '/api/webhooks/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Partner callback', secret: 'incoming-secret' }),
      }),
      request(webhooks, '/api/webhooks/incoming/incoming-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Partner callback' }),
      }),
    ]);
    const [createdBody, updatedBody] = await Promise.all([created.json(), updated.json()]);

    expect(createdBody).toMatchObject({ data: { hasSecret: true } });
    expect(updatedBody).toMatchObject({ data: { hasSecret: true } });
    expect(createdBody).not.toHaveProperty('data.secret');
    expect(updatedBody).not.toHaveProperty('data.secret');
  });

  test('outgoing webhook create and update responses expose only hasSecret', async () => {
    const [created, updated] = await Promise.all([
      request(webhooks, '/api/webhooks/outgoing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Partner notification', url: 'https://example.test/webhook', eventTypes: [], secret: 'outgoing-secret' }),
      }),
      request(webhooks, '/api/webhooks/outgoing/outgoing-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Partner notification' }),
      }),
    ]);
    const [createdBody, updatedBody] = await Promise.all([created.json(), updated.json()]);

    expect(createdBody).toMatchObject({ data: { hasSecret: true } });
    expect(updatedBody).toMatchObject({ data: { hasSecret: true } });
    expect(createdBody).not.toHaveProperty('data.secret');
    expect(updatedBody).not.toHaveProperty('data.secret');
  });
});
