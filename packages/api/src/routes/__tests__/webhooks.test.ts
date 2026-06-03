import { validateWebhookUrl } from '../webhooks';

describe('Webhook URL Validation', () => {
  describe('validateWebhookUrl', () => {
    it('should accept a valid HTTPS URL', () => {
      expect(validateWebhookUrl('https://example.com/webhook')).toBeNull();
    });

    it('should accept a valid HTTPS URL with path and query params', () => {
      expect(validateWebhookUrl('https://api.example.com/hooks/events?token=abc123')).toBeNull();
    });

    it('should accept a valid HTTPS URL with port', () => {
      expect(validateWebhookUrl('https://example.com:8443/webhook')).toBeNull();
    });

    it('should reject non-string values', () => {
      expect(validateWebhookUrl(undefined)).toBe('URL is required and must be a non-empty string');
      expect(validateWebhookUrl(null)).toBe('URL is required and must be a non-empty string');
      expect(validateWebhookUrl(123)).toBe('URL is required and must be a non-empty string');
      expect(validateWebhookUrl({})).toBe('URL is required and must be a non-empty string');
    });

    it('should reject empty string', () => {
      expect(validateWebhookUrl('')).toBe('URL is required and must be a non-empty string');
      expect(validateWebhookUrl('   ')).toBe('URL is required and must be a non-empty string');
    });

    it('should reject HTTP URLs (non-HTTPS)', () => {
      expect(validateWebhookUrl('http://example.com/webhook')).toBe('URL must use HTTPS protocol');
    });

    it('should reject URLs without protocol', () => {
      expect(validateWebhookUrl('example.com/webhook')).toBe('URL must use HTTPS protocol');
    });

    it('should reject URLs with other protocols', () => {
      expect(validateWebhookUrl('ftp://example.com/webhook')).toBe('URL must use HTTPS protocol');
      expect(validateWebhookUrl('ws://example.com/webhook')).toBe('URL must use HTTPS protocol');
    });

    it('should reject URLs exceeding 2048 characters', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2030);
      expect(longUrl.length).toBeGreaterThan(2048);
      expect(validateWebhookUrl(longUrl)).toBe('URL must not exceed 2048 characters');
    });

    it('should accept URLs exactly at 2048 characters', () => {
      const url = 'https://example.com/' + 'a'.repeat(2028);
      expect(url.length).toBe(2048);
      expect(validateWebhookUrl(url)).toBeNull();
    });

    it('should reject invalid URLs that start with https://', () => {
      expect(validateWebhookUrl('https://')).toBe('URL is not a valid URL');
    });
  });
});
