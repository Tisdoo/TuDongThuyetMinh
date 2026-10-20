import type { Poi } from '../api/types';

/** Ảnh POI nếu có; chưa có thì hình minh họa theo loại điểm (tượng, công trình, tiện ích, quán). */
const ART: Record<string, string> = {
  STATUE: 'M24 7.5a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM20.5 16c0-3 7-3 7 0l1 3.5h-9zM20 19.5c-1.6 4-2 10-1.4 15L17.5 37h13l-1.1-2.5c.6-5 .2-11-1.4-15M15 40.5h18',
  HALL: 'M10 22c6-1 11-5 14-9 3 4 8 8 14 9M14 22v14h20V22M21 36v-7h6v7M8 36h32',
  FACILITY: 'M24 10a14 14 0 1 0 0 28 14 14 0 0 0 0-28zM24 21v10M24 16.5v.01',
  SHOP: 'M12 22h24a12 12 0 0 1-24 0zM18 38h12M20 14c0 2 2 2 2 4M26 14c0 2 2 2 2 4',
  OTHER: 'M24 14c3 4 4 9 0 15-4-6-3-11 0-15zM24 29c-5-1-9-4-11-9 5 0 9 3 11 9zM24 29c5-1 9-4 11-9-5 0-9 3-11 9zM14 34h20',
};

export function PoiArt({ poi, category, className }: { poi: Poi; category: string; className?: string }) {
  const img = poi.thumbnailUrl ?? poi.media?.[0]?.url;
  if (img) return <img className={`art ${className ?? ''}`} src={img} alt="" loading="lazy" />;
  return (
    <span className={`art art-${category.toLowerCase()} noimg ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ART[category] ?? ART.OTHER} />
      </svg>
    </span>
  );
}
