import { describe, expect, it, vi } from 'vitest';
import {
  computerLocation,
  computerTimeZone,
  iconPreviewUrl,
} from './computer-defaults';

describe('installer computer defaults', () => {
  it('returns bounded weather coordinates from browser geolocation', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 42.35843,
          longitude: -71.05977,
        },
      } as GeolocationPosition);
    });

    await expect(computerLocation({ getCurrentPosition } as unknown as Geolocation)).resolves.toEqual({
      latitude: '42.35843',
      longitude: '-71.05977',
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  });

  it('reports a denied browser-location permission as a usable configuration message', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => {
      failure({ code: 1, message: 'denied' } as GeolocationPositionError);
    });

    await expect(computerLocation({ getCurrentPosition } as unknown as Geolocation))
      .rejects.toThrow(/permission was denied/i);
  });

  it('uses the installer computer IANA time zone', () => {
    expect(computerTimeZone(() => ({ timeZone: 'America/New_York' }))).toBe('America/New_York');
    expect(() => computerTimeZone(() => ({ timeZone: '' }))).toThrow(/time zone/i);
  });

  it('previews only HTTP image URLs', () => {
    expect(iconPreviewUrl('https://example.com/icon.png')).toBe('https://example.com/icon.png');
    expect(iconPreviewUrl('http://localhost:5173/icon.png')).toBe('http://localhost:5173/icon.png');
    expect(iconPreviewUrl('javascript:alert(1)')).toBe('');
    expect(iconPreviewUrl('data:image/svg+xml,<svg/>')).toBe('');
    expect(iconPreviewUrl('not a url')).toBe('');
  });
});
