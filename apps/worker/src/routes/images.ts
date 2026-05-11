import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

const BUCKET = 'line-harness-images';

function storageUrl(supabaseUrl: string, key: string): string {
  return `${supabaseUrl}/storage/v1/object/${BUCKET}/${key}`;
}

function publicUrl(supabaseUrl: string, key: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${key}`;
}

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 5 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 5MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = filename ? `${id}-${filename}` : `${id}.${ext}`;

    const res = await fetch(storageUrl(SUPABASE_URL, key), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: data,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Supabase Storage upload error:', err);
      return c.json({ success: false, error: 'Upload failed' }, 500);
    }

    const url = publicUrl(SUPABASE_URL, key);
    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/:key — redirect to Supabase CDN (bucket must be public)
images.get('/images/:key', (c) => {
  const key = c.req.param('key');
  return c.redirect(publicUrl(c.env.SUPABASE_URL, key), 302);
});

// DELETE /api/images/:key — delete image from Supabase Storage
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [key] }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Supabase Storage delete error:', err);
      return c.json({ success: false, error: 'Delete failed' }, 500);
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
