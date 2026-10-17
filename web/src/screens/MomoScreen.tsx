import { useEffect } from 'react';
import { api, sleep } from '../api/client';
import type { MomoOrder, TokenRes } from '../api/types';
import { useI18n } from '../i18n-context';
import { fmtMoney } from '../lib/i18n';

interface Props { order: MomoOrder; onToken: (t: TokenRes) => void; onInvalid: (code: string | null) => void; onBack: () => void }

/** MoMo QR: khách chuyển tiền, nhân viên đối soát; app polling authCode giống luồng online (4 giây, ~30 phút). */
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
    <section>
      <h1>{t('momoTitle')}</h1>
      <p>{t('momoStep1')}</p>
      <img
        className="qr" alt="MoMo QR" src={order.qr.imageUrl}
        onError={(e) => { const img = e.currentTarget; if (!img.src.endsWith('/momo-qr.svg')) img.src = '/momo-qr.svg'; }}
      />
      {order.qr.accountName && <p className="muted small center">{order.qr.accountName}</p>}
      <div className="price center">{fmtMoney(order.amount, order.currency)}</div>
      <p className="center">{t('momoNote')}</p>
      <div className="bigcode">{order.qr.transferNote}</div>
      <p className="muted center">{t('momoWaiting')}</p>
      <div className="spinner" />
      <p className="muted small">{t('momoHint')}</p>
      <button className="btn link" onClick={onBack}>{t('back')}</button>
    </section>
  );
}
