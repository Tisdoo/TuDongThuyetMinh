import { useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import { categoryOf, poiName } from '../lib/poi';
import { Icon } from './Icon';
import { PoiArt } from './PoiArt';

/** Gợi ý khi bước vào vùng một điểm (geofence), tự ẩn sau 15 giây. */
export function NearBanner() {
  const { t, lang } = useI18n();
  const g = useGuide();
  const p = g.banner;
  if (!p) return null;
  return (
    <div className="nearbanner" role="status">
      <PoiArt poi={p} category={categoryOf(p, g.dataset)} />
      <button type="button" className="txt" onClick={() => g.openPoi(p)}>
        <small>{t('nearYou')}</small>
        <b>{poiName(p, lang)}</b>
      </button>
      <button type="button" className="playbtn on" aria-label={`${t('listen')}: ${poiName(p, lang)}`}
        onClick={() => { g.openPoi(p); g.listen(p); }}>
        <Icon name="play" size={18} />
      </button>
      <button type="button" className="iconbtn" aria-label={t('close')} onClick={g.dismissBanner}><Icon name="close" size={18} /></button>
    </div>
  );
}
