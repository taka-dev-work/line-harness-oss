import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new NodeUrl('./webhook.ts', import.meta.url)), 'utf8');

describe('webhook concierge priority', () => {
  test('keeps commands and keyword auto-replies before concierge execution', () => {
    const command = source.indexOf('if (timeMatch)');
    const autoReply = source.indexOf('for (const rule of autoReplies)', command);
    const concierge = source.indexOf('handleConciergeMessage', autoReply);

    expect(command).toBeGreaterThan(-1);
    expect(autoReply).toBeGreaterThan(command);
    expect(concierge).toBeGreaterThan(autoReply);
  });

  test('claims LINE webhook IDs before concierge replies', () => {
    expect(source).toContain('INSERT OR IGNORE INTO messages_log');
    expect(source).toContain('event.webhookEventId');
    expect(source.indexOf('INSERT OR IGNORE INTO messages_log'))
      .toBeLessThan(source.indexOf('handleConciergeMessage({'));
  });
});
