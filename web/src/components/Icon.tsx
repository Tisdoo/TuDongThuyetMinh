// Bộ icon nét 1.75px, vẽ trên lưới 24. Dùng currentColor để ăn theo màu chữ.
const PATHS: Record<string, string> = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  stop: 'M7 7h10v10H7z',
  home: 'M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z',
  map: 'M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14',
  ticket: 'M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.6v3.4h-17v-3.4a1.8 1.8 0 0 0 0-3.6zM14 7.5v10',
  locate: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  auto: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  card: 'M3.5 6h17v12h-17zM3.5 10h17M7 14.5h4',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5h1.5M19.5 14v1.5',
  cash: 'M2.5 6.5h19v11h-19zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 12h.01M18 12h.01',
  chat: 'M4 5h16v11H9l-5 4z',
  close: 'M6 6l12 12M18 6 6 18',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0 .01M10 21l2-6-2.5-2.5 1-5L14 9l2.5 3M9.5 12.5 7 14M12 15l3 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M8.5 8.5h11v11h-11zM5 15.5H4.5v-11h11V5',
  sim: 'M9.5 3.5h5M10.5 3.5v6L5.5 18a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3l-5-8.5v-6M8 15h8',
  back: 'M15 5l-7 7 7 7',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
};
const FILLED = new Set(['play', 'pause', 'stop']);

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
