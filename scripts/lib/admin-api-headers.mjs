// Headers for scripts calling the admin API. The admin API only answers through the
// Cloudflare Access-protected admin host, so scripts send an Access service token
// (LINE_HARNESS_ACCESS_CLIENT_ID / _SECRET) alongside a staff API key.

/** @param {Record<string, string | undefined>} env */
export function adminApiHeaders(env) {
  const headers = {
    Authorization: `Bearer ${env.LINE_HARNESS_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (env.LINE_HARNESS_ACCESS_CLIENT_ID && env.LINE_HARNESS_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.LINE_HARNESS_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.LINE_HARNESS_ACCESS_CLIENT_SECRET;
  }
  return headers;
}
