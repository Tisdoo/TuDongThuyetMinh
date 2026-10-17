import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CashOrder, OrderStatus, TokenRes } from '../api/types';
import { useI18n } from '../i18n-context';
import { fmtMoney } from '../lib/i18n';

interface Props { order: CashOrder; onToken: (t: TokenRes) => void; onBack: () => void }

/** Nhánh tiền mặt: hiện mã đơn cho nhân viên, theo dõi trạng thái, nhập mã ngắn nhân viên đọc. */
export function CashScreen({ order, onToken, onBack }: Props) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<OrderStatus>('PENDING');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== 'PENDING') return;
    const id = window.setInterval(async () => {
      try {
        const r = await api.orderStatus(order.orderCode);
        if (r.status === 200 && r.data) setStatus(r.data.status);
      } catch { /* thử lại lần sau */ }
    }, 3000);
    return () => window.clearInterval(id);
  }, [order.orderCode, status]);

  async function submit() {
    const c = code.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.exchangeShort(c, lang);
      if (r.status === 200 && r.data) return onToken(r.data);
      setMsg(r.status === 429 ? t('codeLocked') : r.status === 202 ? t('cashNotYet') : t('codeInvalid'));
    } catch { setMsg(t('networkError')); } finally { setBusy(false); }
  }

  const statusText = status === 'PAID' ? t('cashPaid') : status === 'PENDING' ? t('cashWaiting') : t('cashExpired');

  return (
    <section>
      <h1>{t('cashTitle')}</h1>
      <p>{t('cashStep1')}</p>
      <div className="bigcode">{order.orderCode}</div>
      <div className="price center">{fmtMoney(order.amount, order.currency)}</div>
      <p className={`center ${status === 'PAID' ? 'ok' : 'muted'}`}>{statusText}</p>
      <hr />
      <p>{t('cashStep2')}</p>
      <input
        className="codeinput" maxLength={10} autoComplete="off" autoCapitalize="characters" inputMode="text"
        value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button className="btn primary" disabled={busy || !code.trim()} onClick={submit}>{t('submit')}</button>
      {msg && <p className="err">{msg}</p>}
      <button className="btn link" onClick={onBack}>{t('back')}</button>
    </section>
  );
}
