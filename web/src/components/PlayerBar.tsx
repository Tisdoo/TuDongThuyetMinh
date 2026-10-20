import { useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import { categoryOf, poiName } from '../lib/poi';
import { Icon } from './Icon';
import { PoiArt } from './PoiArt';

/** Thanh đang phát, nằm ngay trên thanh tab; chạm vào để mở chi tiết điểm. */
export function PlayerBar() {
  const { t, lang } = useI18n();
  const g = useGuide();
  const poi = g.narr.playing ? g.pois.find((p) => p.id === g.narr.poiId) : undefined;
  if (!poi) return null;
  return (
    <div className="player" role="region" aria-label={t('playing')}>
      <span className="progress" style={{ transform: `scaleX(${g.narr.progress})` }} />
      <button type="button" className="info" onClick={() => g.openPoi(poi)}>
        <PoiArt poi={poi} category={categoryOf(poi, g.dataset)} />
        <span className="txt"><small>{t('playing')}</small><b>{poiName(poi, lang)}</b></span>
      </button>
      <button type="button" className="iconbtn" aria-label={t('stop')} onClick={g.stopNarration}><Icon name="stop" /></button>
    </div>
  );
}
