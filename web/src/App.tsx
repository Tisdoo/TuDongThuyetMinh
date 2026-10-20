import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { clearToken, getToken, saveToken, setUnauthorizedHandler } from './api/client';
import type { CashOrder, MomoOrder, TokenRes } from './api/types';
import { Icon } from './components/Icon';
import { LangPicker } from './components/LangPicker';
import { NearBanner } from './components/NearBanner';
import { PlayerBar } from './components/PlayerBar';
import { PoiDetail } from './components/PoiDetail';
import { TabBar } from './components/TabBar';
import { GuideProvider, useGuide } from './guide-context';
import { useI18n } from './i18n-context';
import { isI18nKey, LANGS } from './i18n';
import { stop as stopNarration } from './lib/narration';
import { getItem, getJson, KEYS, removeItem, setItem } from './lib/storage';
import { clearTicket, saveTicket } from './lib/ticket';
import { CashScreen } from './screens/CashScreen';
import { HomeTab } from './screens/HomeTab';
import { MapTab } from './screens/MapTab';
import { MomoScreen } from './screens/MomoScreen';
import { TicketTab } from './screens/TicketTab';
import { WaitScreen } from './screens/WaitScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';

type Screen =
  | { name: 'welcome' }
  | { name: 'wait'; authCode: string }
  | { name: 'cash'; order: CashOrder }
  | { name: 'momo'; order: MomoOrder }
  | { name: 'msg'; title: string; text: string; button: string; next: Screen }
  | { name: 'guide' };

/** Màn hình đầu tiên: quay về từ cổng thanh toán, đã có vé, hay còn đơn đang chờ (F5 không mất đơn). */
function initialScreen(): Screen {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith('/payment/return')) {
    const code = url.searchParams.get('auth_code');
    const status = url.searchParams.get('status');
    window.history.replaceState(null, '', '/' + (url.searchParams.get('sim') === '1' ? '?sim=1' : ''));
    if (status === 'failed') {
      removeItem(KEYS.pendingAuth, 'session');
      return { name: 'msg', title: 'payFailTitle', text: 'payFailText', button: 'payAgain', next: { name: 'welcome' } };
    }
    if (code) { setItem(KEYS.pendingAuth, code, 'session'); return { name: 'wait', authCode: code }; }
  }
  if (getToken()) return { name: 'guide' };
  const momo = getJson<MomoOrder>(KEYS.pendingMomo, 'session');
  if (momo) return { name: 'momo', order: momo };
  const cash = getJson<CashOrder>(KEYS.pendingCash, 'session');
  if (cash) return { name: 'cash', order: cash };
  const pending = getItem(KEYS.pendingAuth, 'session');
  if (pending) return { name: 'wait', authCode: pending };
  return { name: 'welcome' };
}

const clearPending = () => {
  for (const k of [KEYS.pendingAuth, KEYS.pendingMomo, KEYS.pendingCash, KEYS.pendingOrder]) removeItem(k, 'session');
};

/** Nút ngôn ngữ ở thanh trên, mở danh sách 6 ngôn ngữ */
function LangButton() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.code === lang);
  return (
    <div className="langbtn-wrap">
      <button type="button" className="langbtn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" size={18} /><span>{current?.nativeName ?? lang}</span>
      </button>
      {open && <div className="langpop"><LangPicker onPick={() => setOpen(false)} /></div>}
    </div>
  );
}

function TopBar() {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <div className="brandmark"><span className="logo" aria-hidden="true" />{t('appName')}</div>
      <LangButton />
    </header>
  );
}

/** Phần hướng dẫn sau khi có vé: ba tab, thanh phát, chi tiết điểm, banner gợi ý. */
function Guide({ onEnd }: { onEnd: () => void }) {
  const g = useGuide();
  // Leaflet cần kích thước thật khi khởi tạo: chỉ dựng bản đồ khi tab được mở lần đầu, sau đó giữ nguyên
  const [mapSeen, setMapSeen] = useState(g.tab === 'map');
  useEffect(() => { if (g.tab === 'map') setMapSeen(true); }, [g.tab]);
  return (
    <div className={`guide tab-${g.tab}${g.narr.playing ? ' has-player' : ''}`}>
      <TopBar />
      <NearBanner />
      <main className="tabs">
        <section hidden={g.tab !== 'home'}><HomeTab /></section>
        <section hidden={g.tab !== 'map'} className="tab-map">{mapSeen && <MapTab active={g.tab === 'map'} />}</section>
        <section hidden={g.tab !== 'ticket'}><TicketTab onEnd={onEnd} /></section>
      </main>
      <PlayerBar />
      <TabBar />
      <PoiDetail />
      {g.toastMsg && <div className="toast" role="status">{g.toastMsg}</div>}
    </div>
  );
}

function UnlockedToast() {
  const { t } = useI18n();
  const { toast } = useGuide();
  useEffect(() => { toast(t('unlocked'), 3500); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function App() {
  const { t, lang } = useI18n();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [justUnlocked, setJustUnlocked] = useState(false);

  useEffect(() => { document.title = t('appName'); }, [t]);
  useEffect(() => { if (screen.name !== 'guide') stopNarration(); }, [screen.name]);

  const toWelcome = useCallback(() => setScreen({ name: 'welcome' }), []);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setScreen({ name: 'msg', title: 'ticketExpiredTitle', text: 'ticketExpired', button: 'payAgain', next: { name: 'welcome' } });
    });
  }, []);

  const gotToken = useCallback((r: TokenRes) => {
    saveToken(r.accessToken);
    saveTicket(r.expiresAt, lang);
    clearPending();
    setJustUnlocked(true);
    setScreen({ name: 'guide' });
  }, [lang]);
  const message = (title: string, text: string, button = 'back', next: Screen = { name: 'welcome' }) =>
    setScreen({ name: 'msg', title, text, button, next });
  const tr = (s: string) => (isI18nKey(s) ? t(s) : s);
  const invalidCode = (code: string | null) => { clearPending(); message('errTitle', `${t('errCode')} (${code})`, 'payAgain'); };
  const cancel = () => { clearPending(); toWelcome(); };

  if (screen.name === 'guide') {
    return (
      <GuideProvider>
        {justUnlocked && <UnlockedToast />}
        <Guide onEnd={() => { clearToken(); clearTicket(); toWelcome(); }} />
      </GuideProvider>
    );
  }
  if (screen.name === 'welcome') {
    return (
      <WelcomeScreen
        onCash={(o) => { setItem(KEYS.pendingCash, JSON.stringify(o), 'session'); setScreen({ name: 'cash', order: o }); }}
        onMomo={(o) => { setItem(KEYS.pendingMomo, JSON.stringify(o), 'session'); setScreen({ name: 'momo', order: o }); }}
        onError={(text) => message('errTitle', text)} />
    );
  }

  let body: ReactNode;
  switch (screen.name) {
    case 'wait':
      body = <WaitScreen authCode={screen.authCode} onToken={gotToken} onInvalid={invalidCode}
        onTimeout={() => message('waitFailTitle', 'waitFailText', 'retry', { name: 'wait', authCode: screen.authCode })} />;
      break;
    case 'cash':
      body = <CashScreen order={screen.order} onToken={gotToken} onBack={cancel} />;
      break;
    case 'momo':
      body = <MomoScreen order={screen.order} onToken={gotToken} onBack={cancel}
        onInvalid={(c) => { clearPending(); message('errTitle', `${t('momoExpired')} (${c})`, 'payAgain'); }} />;
      break;
    case 'msg':
      body = (
        <div className="step center">
          <h1 className="serif">{tr(screen.title)}</h1>
          <p className="muted">{tr(screen.text)}</p>
          <button type="button" className="btn primary wide" onClick={() => setScreen(screen.next)}>{tr(screen.button)}</button>
        </div>
      );
      break;
  }
  return (
    <div className="flow">
      <TopBar />
      <main>{body}</main>
    </div>
  );
}
