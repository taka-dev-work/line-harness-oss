import { describe, expect, test } from 'vitest';
import { escapeHtml, serializeJsonForInlineScript } from './html.js';

describe('HTML output safety', () => {
  test('escapes text and attribute metacharacters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quoted'`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;');
  });

  test('serializes data without allowing an inline script to be closed', () => {
    const serialized = serializeJsonForInlineScript({
      value: '</script><script>alert("x")</script>&\u2028\u2029',
    });

    expect(JSON.parse(serialized)).toEqual({
      value: '</script><script>alert("x")</script>&\u2028\u2029',
    });
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script>');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
  });
});
