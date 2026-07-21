import { describe, expect, it } from 'vitest';
import { isLocalReviewHost } from './dev-review';

describe('local review host detection', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]'])('enables review tools for %s', (hostname) => {
    expect(isLocalReviewHost(hostname)).toBe(true);
  });

  it.each(['example.com', '192.0.2.10', 'custom-companion.github.io'])('keeps review tools hidden for %s', (hostname) => {
    expect(isLocalReviewHost(hostname)).toBe(false);
  });
});
