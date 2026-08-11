import { describe, expect, it, vi } from 'vitest';

import {
  allowedCorsOrigins,
  constantTimeSecretEquals,
  isAllowedWriteOrigin,
  sensitiveNoStore,
} from '../src/security';

describe('SECURITY-1 helpers', () => {
  it('compares secrets without accepting empty values', () => {
    expect(constantTimeSecretEquals('alpha-secret', 'alpha-secret')).toBe(true);
    expect(constantTimeSecretEquals('alpha-secret', 'other-secret')).toBe(false);
    expect(constantTimeSecretEquals('short', 'much-longer-secret')).toBe(false);
    expect(constantTimeSecretEquals('', '')).toBe(false);
    expect(constantTimeSecretEquals(undefined, 'alpha-secret')).toBe(false);
  });

  it('parses CORS origins exactly and rejects lookalikes', () => {
    const configured = 'http://localhost:3000, https://football.example';
    expect(allowedCorsOrigins(configured)).toEqual([
      'http://localhost:3000',
      'https://football.example',
    ]);
    expect(isAllowedWriteOrigin('http://localhost:3000', configured)).toBe(true);
    expect(isAllowedWriteOrigin('http://localhost:3000.evil.test', configured)).toBe(false);
    expect(isAllowedWriteOrigin(undefined, configured)).toBe(true);
  });

  it('marks sensitive API responses as no-store', () => {
    const setHeader = vi.fn();
    const next = vi.fn();

    sensitiveNoStore(
      {} as never,
      { setHeader } as never,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(next).toHaveBeenCalledOnce();
  });
});
