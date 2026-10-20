import { useEffect } from 'react';
import { api, sleep } from '../api/client';
import type { MomoOrder, TokenRes } from '../api/types';
import { CodeStub } from '../components/CodeStub';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n-context';
import { fmtMoney } from '../i18n';

interface Props { order: MomoOrder; onToken: (t: TokenRes) => void; onInvalid: (code: string | null) => void; onBack: () => void }

/** MoMo QR: khách chuyển tiền, nhân viên đối soát; app hỏi authCode giống luồng online (4 giây, khoảng 30 phút). */
export function MomoScreen({ order, onToken, onInvalid, onBack }: Props) {
  const { t, lang } = useI18n();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 450 && !cancelled; i++) {
        try {
          const r = await api.exchange(order.authCode, lang);
          if (cancelled) return;
          if (r.status === 200 && r.data) return onToken(r.data);
          if (r.status !== 202) return onInvalid(r.code);
        } catch { /* mất mạng: thử lại */ }
        await sleep(4000);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lại khi đổi đơn
  }, [order.authCode]);

  return (
    <div className="step">
      <button type="button" className="backlink" onClick={onBack}><Icon name="back" size={18} />{t('cancelOrder')}</button>
      <h1 className="serif">{t('momoTitle')}</h1>
      <p>{t('momoStep1')}</p>
      <div className="qrbox">
        <img src={order.qr.imageUrl} alt="MoMo QR"
          onError={(e) => { const img = e.currentTarget; if (!img.src.endsWith('/momo-qr.svg')) img.src = '/momo-qr.svg'; }} />
        {order.qr.accountName && <p className="muted small">{order.qr.accountName}</p>}
        <p className="price">{fmtMoney(order.amount, order.currency, lang)}</p>
      </div>
      <CodeStub code={order.qr.transferNote} label={t('momoNote')} />
      <p className="status live" role="status">{t('momoWaiting')}</p>
      <p className="muted small">{t('momoHint')}</p>
    </div>
  );
}
