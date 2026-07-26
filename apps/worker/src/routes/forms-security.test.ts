import { describe, expect, test } from 'vitest';
import { buildPublicFormSubmissionContext } from '../services/line-id-token.js';

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
