import type { Poi } from '../api/types';
import { useDistanceLabel, useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import type { I18nKey } from '../i18n';
import { categoryOf, poiName } from '../lib/poi';
import { Icon } from './Icon';
import { PoiArt } from './PoiArt';

/** Danh sách điểm: hình, tên, loại và khoảng cách, nút nghe nhanh. */
export function PoiList({ pois, compact }: { pois: Poi[]; compact?: boolean }) {
  const { t, lang } = useI18n();
  const g = useGuide();
  const dist = useDistanceLabel();
  return (
    <ul className={`poilist${compact ? ' compact' : ''}`}>
      {pois.map((p) => {
        const cat = categoryOf(p, g.dataset);
        const d = g.distances.get(p.id);
        const near = d !== undefined && d <= p.triggerRadiusM;
        const playing = g.narr.poiId === p.id && g.narr.playing;
        return (
          <li key={p.id} className={near ? 'near' : ''}>
            <button type="button" className="poirow" onClick={() => g.openPoi(p)}>
              <PoiArt poi={p} category={cat} />
              <span className="txt">
                <span className="name">{poiName(p, lang)}</span>
                <span className="meta">
                  {t(`cat_${cat}` as I18nKey) ?? cat}
                  {d !== undefined && <span className="dist">{near ? t('nearYou') : dist(d)}</span>}
                </span>
              </span>
            </button>
            <button type="button" className={`playbtn${playing ? ' on' : ''}`}
              aria-label={playing ? t('stop') : `${t('listen')}: ${poiName(p, lang)}`}
              onClick={() => (playing ? g.stopNarration() : g.listen(p))}>
              <Icon name={playing ? 'stop' : 'play'} size={18} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
