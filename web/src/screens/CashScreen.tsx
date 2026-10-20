import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { CashOrder, OrderStatus, TokenRes } from '../api/types';
import { CodeStub } from '../components/CodeStub';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n-context';
import { fmtMoney } from '../i18n';

interface Props { order: CashOrder; onToken: (t: TokenRes) => void; onBack: () => void }

/** Tiền mặt: hiện mã đơn cho nhân viên, theo dõi trạng thái, nhập mã ngắn nhân viên đọc. */
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.exchangeShort(c, lang);
      if (r.status === 200 && r.data) return onToken(r.data);
      setMsg(r.status === 429 ? t('codeLocked') : r.status === 202 ? t('cashNotYet') : t('codeInvalid'));
    } catch { setMsg(t('networkError')); } finally { setBusy(false); }
  }

  const paid = status === 'PAID';
  const dead = !paid && status !== 'PENDING';

  return (
    <div className="step">
      <button type="button" className="backlink" onClick={onBack}><Icon name="back" size={18} />{t('back')}</button>
      <h1 className="serif">{t('cashTitle')}</h1>

      <ol className="steps">
        <li className={paid ? 'done' : 'current'}>
          <p>{t('cashStep1')}</p>
          <CodeStub code={order.orderCode} label={fmtMoney(order.amount, order.currency, lang)} />
          <p className={`status ${paid ? 'ok' : dead ? 'bad' : 'live'}`} role="status">
            {paid ? t('cashPaid') : dead ? t('cashExpired') : t('cashWaiting')}
          </p>
        </li>
        <li className={paid ? 'current' : ''}>
          <form onSubmit={submit}>
            <label htmlFor="shortcode">{t('cashStep2')}</label>
            <input id="shortcode" className="codeinput" maxLength={10} autoComplete="one-time-code" autoCapitalize="characters"
              placeholder={t('codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            {msg && <p className="err" role="alert">{msg}</p>}
            <button type="submit" className="btn primary wide" disabled={busy || !code.trim()}>{t('unlock')}</button>
          </form>
        </li>
      </ol>
    </div>
  );
}
