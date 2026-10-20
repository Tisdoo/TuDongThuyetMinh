import { useMemo, useState } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { HeroArt } from '../components/HeroArt';
import { Icon } from '../components/Icon';
import { PoiList } from '../components/PoiList';
import { useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import { fmtTime, type I18nKey } from '../i18n';
import { categoryOf } from '../lib/poi';
import { getTicket } from '../lib/ticket';

export function HomeTab() {
  const { t, lang } = useI18n();
  const g = useGuide();
  const [cat, setCat] = useState<string | null>(null);
  const [chat, setChat] = useState(false);
  const ticket = getTicket();

  const cats = useMemo(() => [...new Set(g.pois.map((p) => categoryOf(p, g.dataset)))], [g.pois, g.dataset]);
  const list = useMemo(() => {
    const l = g.pois.filter((p) => !cat || categoryOf(p, g.dataset) === cat);
    return g.fix ? [...l].sort((a, b) => (g.distances.get(a.id) ?? 0) - (g.distances.get(b.id) ?? 0)) : l;
  }, [g.pois, g.dataset, g.distances, g.fix, cat]);

  return (
    <div className="home">
      <header className="home-head">
        <HeroArt className="band" />
        <div className="home-title">
          <h1 className="serif">{t('place')}</h1>
          {ticket?.expiresAt && <p>{t('ticketUntil', { time: fmtTime(new Date(ticket.expiresAt), lang) })}</p>}
        </div>
      </header>

      <div className="home-body">
        <div className="toggles">
          <button type="button" className={`switchrow${g.autoplay ? ' on' : ''}`} role="switch" aria-checked={g.autoplay} onClick={g.toggleAutoplay}>
            <span className="sw-ic"><Icon name="auto" /></span>
            <span className="sw-tx"><b>{t('autoTitle')}</b><small>{t('autoText')}</small></span>
            <span className="sw" aria-hidden="true" />
          </button>
          {g.gpsError === 'denied' && (
            <p className="hint"><Icon name="locate" size={18} />{t('gpsDenied')}</p>
          )}
        </div>

        <section aria-labelledby="pois-h">
          <div className="sechead">
            <h2 id="pois-h" className="serif">{t('poisTitle')}</h2>
            <span className="muted small sub">{g.fix ? t('sortedNear') : t('poiCount', { n: g.pois.length })}</span>
          </div>
          {cats.length > 1 && (
            <div className="chips" role="tablist">
              <button type="button" role="tab" aria-selected={!cat} className={!cat ? 'on' : ''} onClick={() => setCat(null)}>{t('all')}</button>
              {cats.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                  {t(`cat_${c}` as I18nKey) ?? c}
                </button>
              ))}
            </div>
          )}
          {g.ds.kind === 'loading' && <p className="empty">{t('loading')}</p>}
          {g.ds.kind === 'empty' && <p className="empty">{t('noDataset')}</p>}
          {g.ds.kind === 'error' && <p className="empty">{g.ds.code === 'NETWORK' ? t('networkError') : `${t('networkError')} (${g.ds.code})`}</p>}
          {g.ds.kind === 'ready' && (list.length ? <PoiList pois={list} /> : <p className="empty">{t('noPoi')}</p>)}
        </section>

        <button type="button" className="askrow" onClick={() => setChat(true)}>
          <span className="sw-ic"><Icon name="chat" /></span>
          <span className="sw-tx"><b>{t('askTitle')}</b><small>{t('askText')}</small></span>
        </button>
      </div>
      {chat && <ChatPanel poiId={g.selected?.id} onClose={() => setChat(false)} />}
    </div>
  );
}
