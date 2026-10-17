import { useEffect, useState } from 'react';
import type { Fix } from '../lib/geofence';

export type GpsError = 'denied' | 'weak' | 'unsupported' | null;

/** navigator.geolocation.watchPosition. Khi paused (đang giả lập vị trí) thì bỏ qua fix thật. */
export function useGeolocation(paused: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<GpsError>(null);

  useEffect(() => {
    if (paused) return;
    if (!('geolocation' in navigator)) { setError('unsupported'); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 999 });
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? 'denied' : 'weak'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [paused]);

  return { fix, setFix, error };
}
