export function validFixture() {
  return {
    slug: 'acme',
    displayName: '株式会社ACME',
    cloudflareAccountId: '0123456789abcdef0123456789abcdef',
    workerName: 'ai-line-crm',
    d1DatabaseName: 'ai-line-crm',
    d1DatabaseId: '01234567-89ab-cdef-0123-456789abcdef',
    customDomain: 'line.acme.example',
    adminDomain: 'admin.acme.example',
    release: { tag: 'v0.14.0-nibel.1', commit: '0123456789abcdef0123456789abcdef01234567' },
    build: { VITE_LIFF_ID: '1234567890-abcdefgh', VITE_BOT_BASIC_ID: '@acme' },
  };
}
