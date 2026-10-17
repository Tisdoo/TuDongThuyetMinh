import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n-context';

interface Msg { from: 'me' | 'bot'; text: string; error?: boolean }

/** Khung chat cơ bản gọi POST /api/chat (Chatbot prototype của người B). Service chưa chạy -> báo chưa sẵn sàng. */
export function ChatPanel({ poiId, onClose }: { poiId?: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: t('chatHello') }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
      else reply = { from: 'bot', text: `${t('chatError')} (${r.code})`, error: true };
    } catch {
      reply = { from: 'bot', text: t('networkError'), error: true };
    }
    setMsgs((m) => [...m, reply]);
    setLoading(false);
  }

  return (
    <div className="chat" role="dialog" aria-label={t('chatTitle')}>
      <div className="chat-head">
        <strong>{t('chatTitle')}</strong>
        <button className="x" aria-label="close" onClick={onClose}>&times;</button>
      </div>
      <div className="chat-list" ref={listRef}>
        {msgs.map((m, i) => <div key={i} className={`bubble ${m.from}${m.error ? ' error' : ''}`}>{m.text}</div>)}
        {loading && <div className="bubble bot typing"><span /><span /><span /></div>}
      </div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('chatPlaceholder')} maxLength={500} />
        <button className="btn primary small" disabled={loading || !input.trim()}>{t('chatSend')}</button>
      </form>
    </div>
  );
}
