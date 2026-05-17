// Google Calendar API client

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEZONE = 'Asia/Tokyo';

export interface GoogleCalendarConfig {
  calendarId: string;
  accessToken: string;
}

export interface BusyInterval {
  start: string;
  end: string;
}

export interface CreateEventInput {
  summary: string;
  start: string;   // ISO datetime string
  end: string;     // ISO datetime string
  description?: string;
  location?: string;
  createMeet?: boolean;
}

export interface ServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function getGoogleCalendarAccessToken(config: ServiceAccountConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(config.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google OAuth token error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Google OAuth token response missing access_token');
  return data.access_token;
}

export class GoogleCalendarClient {
  constructor(private config: GoogleCalendarConfig) {}

  /**
   * Get busy time intervals from Google Calendar FreeBusy API.
   * Returns an array of { start, end } intervals when the calendar is busy.
   */
  async getFreeBusy(timeMin: string, timeMax: string): Promise<BusyInterval[]> {
    const url = `${GCAL_BASE}/freeBusy`;
    const body = {
      timeMin,
      timeMax,
      items: [{ id: this.config.calendarId }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google FreeBusy API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };

    const calendarData = data.calendars?.[this.config.calendarId];
    return calendarData?.busy ?? [];
  }

  /**
   * Create an event on Google Calendar.
   * Returns the created event's ID.
   */
  async createEvent(event: CreateEventInput): Promise<{ eventId: string; meetUrl: string | null; htmlLink: string | null }> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events${event.createMeet ? '?conferenceDataVersion=1' : ''}`;

    const body: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start, timeZone: TIMEZONE },
      end: { dateTime: event.end, timeZone: TIMEZONE },
    };
    if (event.createMeet) {
      body.conferenceData = {
        createRequest: {
          requestId: `meet-${crypto.randomUUID()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar createEvent error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    };
    if (!data.id) {
      throw new Error('Google Calendar createEvent: response missing event id');
    }

    const meetUrl = data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ?? null;
    return { eventId: data.id, meetUrl, htmlLink: data.htmlLink ?? null };
  }

  /**
   * Delete an event from Google Calendar.
   */
  async deleteEvent(eventId: string): Promise<void> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events/${encodeURIComponent(eventId)}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    // 204 = success, 410 = already deleted — both are acceptable
    if (!res.ok && res.status !== 410) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar deleteEvent error ${res.status}: ${text}`);
    }
  }
}
