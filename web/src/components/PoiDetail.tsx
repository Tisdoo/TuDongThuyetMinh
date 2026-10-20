import { useEffect, useRef } from 'react';
import { useDistanceLabel, useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import type { I18nKey } from '../i18n';
import { categoryOf, languageName, poiContent } from '../lib/poi';
import { Icon } from './Icon';
import { PoiArt } from './PoiArt';

/** Chi tiết một điểm: trượt lên từ dưới trên điện thoại, hộp giữa màn hình trên máy tính. */
export function PoiDetail() {
  const { t, lang } = useI18n();
  const g = useGuide();
  const dist = useDistanceLabel();
  const closeRef = useRef<HTMLButtonElement>(null);
  const poi = g.selected;

  useEffect(() => {
    if (!poi) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') g.closePoi(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poi, g]);

  if (!poi) return null;
  const { c, code, fallback } = poiContent(poi, lang);
  const cat = categoryOf(poi, g.dataset);
  const d = g.distances.get(poi.id);
  const playing = g.narr.poiId === poi.id && g.narr.playing;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}&travelmode=walking`;

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="scrim" onClick={g.closePoi} />
      <article className="panel">
        <div className="cover">
          <PoiArt poi={poi} category={cat} className="big" />
          <button ref={closeRef} type="button" className="iconbtn closebtn" aria-label={t('close')} onClick={g.closePoi}>
            <Icon name="close" />
          </button>
        </div>
        <div className="body">
          <p className="meta">
            {t(`cat_${cat}` as I18nKey) ?? cat}
            {d !== undefined && <span className="dist">{dist(d)}</span>}
          </p>
          <h2 id="detail-title" className="serif">{c?.name ?? poi.code}</h2>

          <button type="button" className={`btn primary wide listen${playing ? ' playing' : ''}`} disabled={!c}
            onClick={() => (playing ? g.stopNarration() : g.listen(poi))}>
            <Icon name={playing ? 'stop' : 'play'} size={18} />
            {playing ? t('stop') : t('listen')}
            {playing && <span className="bar" style={{ transform: `scaleX(${g.narr.progress})` }} />}
          </button>
          <div className="row2">
            <button type="button" className="btn" onClick={() => g.focusOnMap(poi)}><Icon name="map" size={18} />{t('viewOnMap')}</button>
            <a className="btn" href={directions} target="_blank" rel="noreferrer"><Icon name="walk" size={18} />{t('directions')}</a>
          </div>

          {c?.shortDescription && <p className="lead">{c.shortDescription}</p>}
          {c?.description && <p className="desc">{c.description}</p>}
          <p className="note">
            {fallback && code && <>{t('fallbackNote', { lang: languageName(code, g.dataset?.languages) })} </>}
            {c?.audioUrl ? t('audioPre') : t('audioLocal')}
          </p>
        </div>
      </article>
    </div>
  );
}
