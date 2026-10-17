import type { Language, Poi } from '../api/types';
import { useI18n } from '../i18n-context';
import { languageName, poiContent } from '../lib/poi';

interface Props {
  poi: Poi;
  languages: Language[];
  distanceM: number | null;
  speaking: boolean;
  onListen: () => void;
  onStop: () => void;
  onClose: () => void;
}

/** Bottom-sheet chi tiết POI: tên, khoảng cách, ảnh, mô tả, nút Nghe / Dừng / Chỉ đường. */
export function PoiSheet({ poi, languages, distanceM, speaking, onListen, onStop, onClose }: Props) {
  const { t, lang } = useI18n();
  const { c, code, fallback } = poiContent(poi, lang);
  const img = poi.thumbnailUrl ?? poi.media[0]?.url ?? null;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}&travelmode=walking`;

  return (
    <div className="sheet" role="dialog" aria-label={c?.name ?? poi.code}>
      <div className="grip" />
      <button className="x" aria-label="close" onClick={onClose}>&times;</button>
      <h2>{c?.name ?? poi.code}</h2>
      {distanceM !== null && <div className="muted small">{t('distAway', { m: Math.round(distanceM) })}</div>}
      {img && <img className="thumb" src={img} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      {c?.shortDescription && <p className="strong">{c.shortDescription}</p>}
      {c?.description && <p>{c.description}</p>}
      {fallback && code && <p className="muted small">{t('fallbackNote', { lang: languageName(code, languages) })}</p>}
      <p className="muted small">{c?.audioUrl ? t('audioPre') : t('audioLocal')}</p>
      <div className="row">
        {speaking
          ? <button className="btn" onClick={onStop}>{t('stop')}</button>
          : <button className="btn primary" onClick={onListen} disabled={!c}>{t('listen')}</button>}
        <a className="btn" href={directions} target="_blank" rel="noreferrer">{t('directions')}</a>
      </div>
    </div>
  );
}
