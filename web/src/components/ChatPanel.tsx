import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n-context';
import { Icon } from './Icon';

interface Msg { from: 'me' | 'bot'; text: string; error?: boolean }

/** Hỏi đáp: POST /api/chat (chatbot prototype của người B). Service chưa chạy thì báo chưa sẵn sàng. */
export function ChatPanel({ poiId, onClose }: { poiId?: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: t('chatHello') }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, loading]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMsgs((m) => [...m, { from: 'me', text: q }]);
    setLoading(true);
    let reply: Msg;
    try {
      const r = await api.chat(q, lang, poiId);
      if (r.status === 200 && r.data?.answer) reply = { from: 'bot', text: r.data.answer };
      else if (r.status === 502 || r.status === 404 || r.status === 503) reply = { from: 'bot', text: t('chatUnavailable'), error: true };
      else reply = { from: 'bot', text: t('chatError'), error: true };
    } catch {
      reply = { from: 'bot', text: t('networkError'), error: true };
    }
    setMsgs((m) => [...m, reply]);
    setLoading(false);
  }

  return (
    <div className="chat" role="dialog" aria-modal="true" aria-label={t('chatTitle')}>
      <div className="chat-head">
        <h2 className="serif">{t('chatTitle')}</h2>
        <button type="button" className="iconbtn" aria-label={t('close')} onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {msgs.map((m, i) => <p key={i} className={`bubble ${m.from}${m.error ? ' error' : ''}`}>{m.text}</p>)}
        {loading && <p className="bubble bot typing" aria-label="..."><span /><span /><span /></p>}
      </div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('chatPlaceholder')} maxLength={500} aria-label={t('chatPlaceholder')} />
        <button type="submit" className="btn primary sm" disabled={loading || !input.trim()}>{t('chatSend')}</button>
      </form>
    </div>
  );
}
