export type PublicFormSubmissionBody = {
  lineUserId?: string;
  friendId?: string;
  _skipWebhook?: boolean;
  trackedLinkId?: string;
  data?: Record<string, unknown>;
};

export type PublicFormSubmissionContext = {
  data: Record<string, unknown>;
  trackedLinkId: string | null;
  lineUserId: string | null;
  friendId: string | null;
  rejected: boolean;
  shouldValidateWebhook: true;
  allowSideEffects: boolean;
  sideEffects: {
    addTags: boolean;
    enrollScenarios: boolean;
    updateMetadata: boolean;
    sendReply: boolean;
    issueAffiliateReward: boolean;
  };
};

function stripPublicControlFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const { _skipWebhook, _webhookVerified, friendId, lineUserId, ...submissionData } = data ?? {};
  void _skipWebhook;
  void _webhookVerified;
  void friendId;
  void lineUserId;
  return submissionData;
}

export function getLineIdTokenFromAuthorization(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

export async function verifyLineIdToken(
  idToken: string | null,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!idToken || !clientId) return null;

  try {
    const response = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
    if (!response.ok) return null;

    const verified = await response.json() as { sub?: unknown };
    return typeof verified.sub === 'string' && verified.sub ? verified.sub : null;
  } catch (error) {
    console.error('LINE ID token verification failed:', error);
    return null;
  }
}

export function buildPublicFormSubmissionContext(
  body: PublicFormSubmissionBody,
  verifiedLineUserId: string | null,
  options: { trustedFriendId?: string | null } = {},
): PublicFormSubmissionContext {
  const rejected = Boolean(
    verifiedLineUserId && body.lineUserId && body.lineUserId !== verifiedLineUserId,
  );
  const friendId = rejected ? null : options.trustedFriendId ?? null;
  const allowSideEffects = Boolean(friendId);

  return {
    data: stripPublicControlFields(body.data),
    trackedLinkId: typeof body.trackedLinkId === 'string' ? body.trackedLinkId : null,
    lineUserId: rejected ? null : verifiedLineUserId,
    friendId,
    rejected,
    shouldValidateWebhook: true,
    allowSideEffects,
    sideEffects: {
      addTags: allowSideEffects,
      enrollScenarios: allowSideEffects,
      updateMetadata: allowSideEffects,
      sendReply: allowSideEffects,
      issueAffiliateReward: allowSideEffects,
    },
  };
}
