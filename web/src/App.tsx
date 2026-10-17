import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { clearToken, getToken, saveToken, setUnauthorizedHandler } from './api/client';
import type { CashOrder, Language, MomoOrder, TokenRes } from './api/types';
import { useI18n } from './i18n-context';
import { DEFAULT_LANGS, isI18nKey } from './lib/i18n';
import { stop as stopNarration } from './lib/narration';
import { getItem, getJson, KEYS, removeItem, setItem } from './lib/storage';
import { CashScreen } from './screens/CashScreen';
import { MapScreen } from './screens/MapScreen';
import { MomoScreen } from './screens/MomoScreen';
import { PayScreen } from './screens/PayScreen';
import { WaitScreen } from './screens/WaitScreen';

type Screen =
  | { name: 'pay' }
  | { name: 'wait'; authCode: string }
  | { name: 'cash'; order: CashOrder }
  | { name: 'momo'; order: MomoOrder }
  | { name: 'msg'; title: string; text: string; button: string; next: Screen }
  | { name: 'map' };

/** Màn hình đầu tiên: quay về từ cổng thanh toán, đã có token, hay còn đơn đang chờ (F5 không mất đơn). */
function initialScreen(): Screen {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith('/payment/return')) {
    const code = url.searchParams.get('auth_code');
    const status = url.searchParams.get('status');
    window.history.replaceState(null, '', '/' + (url.searchParams.get('sim') === '1' ? '?sim=1' : ''));
    if (status === 'failed') {
      removeItem(KEYS.pendingAuth, 'session');
      return { name: 'msg', title: 'payFailTitle', text: 'payFailText', button: 'payAgain', next: { name: 'pay' } };
    }
    if (code) { setItem(KEYS.pendingAuth, code, 'session'); return { name: 'wait', authCode: code }; }
  }
  if (getToken()) return { name: 'map' };
  const momo = getJson<MomoOrder>(KEYS.pendingMomo, 'session');
  if (momo) return { name: 'momo', order: momo };
  const cash = getJson<CashOrder>(KEYS.pendingCash, 'session');
  if (cash) return { name: 'cash', order: cash };
  const pending = getItem(KEYS.pendingAuth, 'session');
  if (pending) return { name: 'wait', authCode: pending };
  return { name: 'pay' };
}

const clearPending = () => {
  for (const k of [KEYS.pendingAuth, KEYS.pendingMomo, KEYS.pendingCash]) removeItem(k, 'session');
};

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [languages, setLanguages] = useState<Language[]>(DEFAULT_LANGS);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { document.title = t('title'); }, [t]);
  useEffect(() => { if (screen.name !== 'map') stopNarration(); }, [screen.name]);

  const toPay = useCallback(() => setScreen({ name: 'pay' }), []);
  useEffect(() => { setUnauthorizedHandler(() => { clearToken(); setScreen({ name: 'pay' }); }); }, []);

  const gotToken = useCallback((r: TokenRes) => {
    saveToken(r.accessToken);
    clearPending();
    setScreen({ name: 'map' });
  }, []);
  // title/text/button của màn hình thông báo là khóa i18n, hoặc chuỗi đã dịch sẵn
  const message = (title: string, text: string, button = 'back', next: Screen = { name: 'pay' }) =>
    setScreen({ name: 'msg', title, text, button, next });
  const tr = (s: string) => (isI18nKey(s) ? t(s) : s);
  const invalidCode = (code: string | null) => { clearPending(); message('errTitle', `${t('errCode')} (${code})`, 'payAgain'); };

  let body: ReactNode;
  switch (screen.name) {
    case 'pay':
      body = <PayScreen
        onCash={(o) => { setItem(KEYS.pendingCash, JSON.stringify(o), 'session'); setScreen({ name: 'cash', order: o }); }}
        onMomo={(o) => { setItem(KEYS.pendingMomo, JSON.stringify(o), 'session'); setScreen({ name: 'momo', order: o }); }}
        onError={(text) => message('errTitle', text)} />;
      break;
    case 'wait':
      body = <WaitScreen authCode={screen.authCode} onToken={gotToken} onInvalid={invalidCode}
        onTimeout={() => message('waitFailTitle', 'waitFailText', 'retry', { name: 'wait', authCode: screen.authCode })} />;
      break;
    case 'cash':
      body = <CashScreen order={screen.order} onToken={gotToken} onBack={() => { clearPending(); toPay(); }} />;
      break;
    case 'momo':
      body = <MomoScreen order={screen.order} onToken={gotToken} onInvalid={(c) => { clearPending(); message('errTitle', `${t('momoExpired')} (${c})`, 'payAgain'); }}
        onBack={() => { clearPending(); toPay(); }} />;
      break;
    case 'msg':
      body = (
        <section>
          <h1>{tr(screen.title)}</h1>
          <p>{tr(screen.text)}</p>
          <button className="btn primary" onClick={() => setScreen(screen.next)}>{tr(screen.button)}</button>
        </section>
      );
      break;
    case 'map':
      body = <MapScreen onLanguages={setLanguages} />;
      break;
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">{t('title')}</div>
        <button className="circle" aria-label="Language" onClick={() => setMenuOpen((o) => !o)}>
          {lang.split('-')[0].toUpperCase()}
        </button>
      </header>
      {menuOpen && (
        <div className="menu">
          {languages.map((l) => (
            <button key={l.code} className={l.code === lang ? 'active' : ''} onClick={() => { setLang(l.code); setMenuOpen(false); }}>
              {l.nativeName || l.name}
            </button>
          ))}
          {screen.name === 'map' && (
            <button onClick={() => { clearToken(); setMenuOpen(false); toPay(); }}>{t('logout')}</button>
          )}
        </div>
      )}
      {screen.name === 'map' ? body : <main className="screens">{body}</main>}
    </>
  );
}
