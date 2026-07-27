export interface ComputerCoordinates {
  latitude: string;
  longitude: string;
}

type TimeZoneOptions = {
  timeZone?: string;
};

function coordinate(value: number, minimum: number, maximum: number, label: string): string {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`The installer computer returned an invalid ${label}. Enter the value manually.`);
  }
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function locationError(error: GeolocationPositionError): Error {
  if (error.code === 1) {
    return new Error('Location permission was denied. Allow location access for this installer or enter latitude and longitude manually.');
  }
  if (error.code === 2) {
    return new Error('The installer computer could not determine its location. Enter latitude and longitude manually.');
  }
  if (error.code === 3) {
    return new Error('The installer computer location request timed out. Try again or enter latitude and longitude manually.');
  }
  return new Error('The installer computer location is unavailable. Enter latitude and longitude manually.');
}

export function computerLocation(
  geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<ComputerCoordinates> {
  if (!geolocation) {
    return Promise.reject(new Error('This browser does not provide computer location access. Enter latitude and longitude manually.'));
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve({
            latitude: coordinate(position.coords.latitude, -90, 90, 'latitude'),
            longitude: coordinate(position.coords.longitude, -180, 180, 'longitude'),
          });
        } catch (error) {
          reject(error);
        }
      },
      (error) => reject(locationError(error)),
      {
        enableHighAccuracy: false,
        maximumAge: 300_000,
        timeout: 10_000,
      },
    );
  });
}

export function computerTimeZone(
  resolveOptions: () => TimeZoneOptions = () => Intl.DateTimeFormat().resolvedOptions(),
): string {
  const timeZone = String(resolveOptions().timeZone || '').trim();
  if (!timeZone) {
    throw new Error('The installer computer did not provide an IANA time zone. Enter the time zone manually.');
  }
  return timeZone;
}

export function iconPreviewUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}
