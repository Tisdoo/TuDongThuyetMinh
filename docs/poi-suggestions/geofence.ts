/**
 * GOI Y CHO FRONTEND (UC-T13): engine kich hoat noi dung theo vi tri.
 * Chay hoan toan tren may khach, doc POI tu dataset da tai (khong goi API).
 *
 * Dung voi: navigator.geolocation.watchPosition(pos => engine.update(...))
 */
export interface GeoPoi {
  id: string;
  lat: number;
  lng: number;
  triggerRadiusM: number;
  priority: number;
}
export interface Fix { lat: number; lng: number; accuracy: number }

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class GeofenceEngine {
  private inside = new Set<string>();
  private lastTriggered = new Map<string, number>();

  constructor(
    private pois: GeoPoi[],
    private opts = { exitBufferM: 10, cooldownMs: 5 * 60_000, maxAccuracyM: 50 },
  ) {}

  /** Tra ve POI can goi y/phat (hoac null). Business rules BR3: hysteresis + cooldown + chon theo priority roi khoang cach. */
  update(fix: Fix, now = Date.now()): GeoPoi | null {
    if (fix.accuracy > this.opts.maxAccuracyM) return null; // GPS yeu: bo qua

    const entered: Array<{ poi: GeoPoi; dist: number }> = [];
    for (const poi of this.pois) {
      const dist = haversineM(fix, poi);
      const was = this.inside.has(poi.id);
      if (!was && dist <= poi.triggerRadiusM) {
        this.inside.add(poi.id);
        const last = this.lastTriggered.get(poi.id) ?? 0;
        if (now - last >= this.opts.cooldownMs) entered.push({ poi, dist });
      } else if (was && dist >= poi.triggerRadiusM + this.opts.exitBufferM) {
        this.inside.delete(poi.id); // chi roi vung khi vuot bien + buffer -> tranh nhap nhay
      }
    }
    if (!entered.length) return null;
    entered.sort((a, b) => b.poi.priority - a.poi.priority || a.dist - b.dist);
    const pick = entered[0].poi;
    this.lastTriggered.set(pick.id, now);
    return pick;
  }

  /** POI trong ban kinh (vd 100 m) de lam noi bat tren ban do. */
  nearby(fix: Fix, radiusM = 100): Array<GeoPoi & { distanceM: number }> {
    return this.pois
      .map((p) => ({ ...p, distanceM: haversineM(fix, p) }))
      .filter((p) => p.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
  }
}
