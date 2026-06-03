import * as fc from 'fast-check';
import { validateWebhookUrl } from '../webhooks';

/**
 * Property-based tests for webhook URL validation.
 *
 * Property 5: Webhook URL validation accepts only valid HTTPS URLs
 *
 * For any string submitted as a webhook URL, the API SHALL accept it if and only if
 * it is a valid HTTPS URL of no more than 2048 characters. All other strings (HTTP,
 * non-URL strings, URLs exceeding 2048 characters) SHALL be rejected.
 *
 * **Validates: Requirements 2.5**
 */
describe('Property 5: Webhook URL validation accepts only valid HTTPS URLs', () => {
  // --- Generators ---

  // Generator for valid domain segments
  const domainLabelArb = fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
    ),
    { minLength: 1, maxLength: 20 }
  );

  // Generator for valid domain names (e.g., "example.com", "api.service.io")
  const domainArb = fc
    .tuple(
      fc.array(domainLabelArb, { minLength: 1, maxLength: 3 }),
      fc.constantFrom('com', 'org', 'net', 'io', 'dev', 'co')
    )
    .map(([labels, tld]) => `${labels.join('.')}.${tld}`);

  // Generator for optional path segments
  const pathSegmentArb = fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
    ),
    { minLength: 1, maxLength: 20 }
  );

  const pathArb = fc
    .array(pathSegmentArb, { minLength: 0, maxLength: 4 })
    .map((segments) => (segments.length > 0 ? '/' + segments.join('/') : ''));

  // Generator for optional port
  const portArb = fc.oneof(
    fc.constant(''),
    fc.integer({ min: 1, max: 65535 }).map((p) => `:${p}`)
  );

  // Generator for valid HTTPS URLs (should be ACCEPTED)
  const validHttpsUrlArb = fc
    .tuple(domainArb, portArb, pathArb)
    .map(([domain, port, path]) => `https://${domain}${port}${path}`)
    .filter((url) => url.length <= 2048);

  // Generator for HTTP URLs (should be REJECTED)
  const httpUrlArb = fc
    .tuple(domainArb, portArb, pathArb)
    .map(([domain, port, path]) => `http://${domain}${port}${path}`)
    .filter((url) => url.length <= 2048);

  // Generator for FTP/other protocol URLs (should be REJECTED)
  const otherProtocolUrlArb = fc
    .tuple(
      fc.constantFrom('ftp', 'ws', 'wss', 'ssh', 'file', 'mailto', 'telnet'),
      domainArb,
      pathArb
    )
    .map(([proto, domain, path]) => `${proto}://${domain}${path}`)
    .filter((url) => url.length <= 2048);

  // Generator for non-URL strings (should be REJECTED)
  const nonUrlStringArb = fc.oneof(
    // Random alphanumeric strings
    fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz0123456789 !@#$%^&*'.split('')
      ),
      { minLength: 1, maxLength: 100 }
    ),
    // Strings that look like domains but have no protocol
    domainArb.map((d) => `${d}/path`),
    // Strings with only partial protocol
    domainArb.map((d) => `htt://${d}`),
    // Empty-ish strings
    fc.constantFrom('', '   ', '\t', '\n')
  );

  // Generator for URLs exceeding 2048 characters (should be REJECTED)
  const longUrlArb = fc
    .integer({ min: 2030, max: 3000 })
    .map((extraLen) => `https://example.com/${'a'.repeat(extraLen)}`);

  // --- Property Tests ---

  it('should accept all valid HTTPS URLs within 2048 characters', () => {
    fc.assert(
      fc.property(validHttpsUrlArb, (url) => {
        const result = validateWebhookUrl(url);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('should reject all HTTP URLs', () => {
    fc.assert(
      fc.property(httpUrlArb, (url) => {
        const result = validateWebhookUrl(url);
        expect(result).not.toBeNull();
        expect(result).toBe('URL must use HTTPS protocol');
      }),
      { numRuns: 100 }
    );
  });

  it('should reject all non-URL strings', () => {
    fc.assert(
      fc.property(nonUrlStringArb, (str) => {
        const result = validateWebhookUrl(str);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('should reject all URLs exceeding 2048 characters', () => {
    fc.assert(
      fc.property(longUrlArb, (url) => {
        const result = validateWebhookUrl(url);
        expect(result).not.toBeNull();
        expect(result).toBe('URL must not exceed 2048 characters');
      }),
      { numRuns: 100 }
    );
  });

  it('should reject all FTP/other protocol URLs', () => {
    fc.assert(
      fc.property(otherProtocolUrlArb, (url) => {
        const result = validateWebhookUrl(url);
        expect(result).not.toBeNull();
        expect(result).toBe('URL must use HTTPS protocol');
      }),
      { numRuns: 100 }
    );
  });
});
