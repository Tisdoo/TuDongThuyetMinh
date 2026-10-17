/**
 * Engine kích hoạt nội dung theo vị trí (UC-T13), lấy từ docs/poi-suggestions/geofence.ts.
 * Chạy hoàn toàn trên máy khách, đọc POI từ dataset đã tải (không gọi API).
 * Khác bản gốc: không dùng "parameter properties" trong constructor (tsconfig bật erasableSyntaxOnly)
 * và có reset() để dùng lại khi tải dataset mới.
 */
export interface GeoPoi {
  id: string;
  lat: number;
  lng: number;
  triggerRadiusM: number;
  priority: number;
}
export interface Fix { lat: number; lng: number; accuracy: number }
export interface GeofenceOptions { exitBufferM: number; cooldownMs: number; maxAccuracyM: number }

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class GeofenceEngine<P extends GeoPoi = GeoPoi> {
  private inside = new Set<string>();
  private lastTriggered = new Map<string, number>();
  private pois: P[];
  private opts: GeofenceOptions;

  constructor(pois: P[], opts: Partial<GeofenceOptions> = {}) {
    this.pois = pois;
    this.opts = { exitBufferM: 10, cooldownMs: 5 * 60_000, maxAccuracyM: 50, ...opts };
  }

  /** Trả về POI cần gợi ý/phát (hoặc null). BR3: hysteresis + cooldown + chọn theo priority rồi khoảng cách. */
  update(fix: Fix, now = Date.now()): P | null {
    if (fix.accuracy > this.opts.maxAccuracyM) return null; // GPS yếu: bỏ qua

    const entered: Array<{ poi: P; dist: number }> = [];
    for (const poi of this.pois) {
      const dist = haversineM(fix, poi);
      const was = this.inside.has(poi.id);
      if (!was && dist <= poi.triggerRadiusM) {
        this.inside.add(poi.id);
        const last = this.lastTriggered.get(poi.id);
        if (last === undefined || now - last >= this.opts.cooldownMs) entered.push({ poi, dist });
      } else if (was && dist >= poi.triggerRadiusM + this.opts.exitBufferM) {
        this.inside.delete(poi.id); // chỉ rời vùng khi vượt biên + buffer -> tránh nhấp nháy
      }
    }
    if (!entered.length) return null;
    entered.sort((a, b) => b.poi.priority - a.poi.priority || a.dist - b.dist);
    const pick = entered[0].poi;
    this.lastTriggered.set(pick.id, now);
    return pick;
  }

  /** POI trong bán kính (vd 100 m) để làm nổi bật trên bản đồ. */
  nearby(fix: Fix, radiusM = 100): Array<P & { distanceM: number }> {
    return this.pois
      .map((p) => ({ ...p, distanceM: haversineM(fix, p) }))
      .filter((p) => p.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
  }

  reset() { this.inside.clear(); this.lastTriggered.clear(); }
}
