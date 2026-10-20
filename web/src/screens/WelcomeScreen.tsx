import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CashOrder, MomoOrder, Product } from '../api/types';
import { HeroArt } from '../components/HeroArt';
import { Icon, type IconName } from '../components/Icon';
import { LangPicker } from '../components/LangPicker';
import { useI18n } from '../i18n-context';
import { fmtMoney, type I18nKey } from '../i18n';
import { KEYS, setItem } from '../lib/storage';
import { savePendingOrder } from '../lib/ticket';

interface Props {
  onCash: (o: CashOrder) => void;
  onMomo: (o: MomoOrder) => void;
  onError: (text: string) => void;
}

const METHODS: Array<{ id: 'online' | 'momo' | 'cash'; icon: IconName; title: I18nKey; sub: I18nKey }> = [
  { id: 'online', icon: 'card', title: 'payOnline', sub: 'payOnlineSub' },
  { id: 'momo', icon: 'qr', title: 'payMomo', sub: 'payMomoSub' },
  { id: 'cash', icon: 'cash', title: 'payCash', sub: 'payCashSub' },
];

/** Màn hình đầu khi chưa có vé: giới thiệu, chọn ngôn ngữ, mua vé. */
export function WelcomeScreen({ onCash, onMomo, onError }: Props) {
  const { t, lang } = useI18n();
  const [product, setProduct] = useState<Product | null>(null);
  const [priceErr, setPriceErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.products()
      .then((r) => {
        const list = r.data ?? [];
        setProduct(list.find((p) => p.code === 'DAY_PASS') ?? list[0] ?? null);
        setPriceErr(!list.length);
      })
      .catch(() => setPriceErr(true));
  }, []);

  const productCode = product?.code ?? 'DAY_PASS';

  async function pay(id: 'online' | 'momo' | 'cash') {
    setBusy(id);
    try {
      if (id === 'online') {
        const r = await api.createOnline(productCode, lang);
        if (r.status !== 201 || !r.data) return onError(`${t('errPayment')} (${r.code})`);
        setItem(KEYS.pendingAuth, r.data.authCode, 'session');
        savePendingOrder(r.data.orderCode, 'ONLINE');
        // Sang cổng thanh toán (VNPAY sandbox hoặc Payoo mock); xong sẽ quay về /payment/return
        window.location.href = r.data.paymentUrl;
        return;
      }
      if (id === 'momo') {
        const r = await api.createMomo(productCode, lang);
        if (r.status !== 201 || !r.data) return onError(`${t('errPayment')} (${r.code})`);
        savePendingOrder(r.data.orderCode, 'MOMO');
        return onMomo(r.data);
      }
      const r = await api.createCash(productCode, lang);
      if (r.status !== 201 || !r.data) return onError(`${t('errPayment')} (${r.code})`);
      savePendingOrder(r.data.orderCode, 'CASH');
      onCash(r.data);
    } catch {
      onError(t('networkError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-art">
        <HeroArt />
        <div className="brandmark"><span className="logo" aria-hidden="true" />{t('appName')}</div>
      </div>

      <div className="welcome-body">
        <h1 className="serif display">{t('place')}</h1>
        <p className="region">{t('region')}</p>
        <p className="intro">{t('heroLine')}</p>

        <h2 className="label">{t('langLabel')}</h2>
        <LangPicker />

        <div className="ticketline">
          <div>
            <h2 className="label">{t('ticketTitle')}</h2>
            <p className="muted small">{product ? t('validFor', { h: product.validity_hours }) : priceErr ? t('networkError') : ' '}</p>
          </div>
          <span className="price">{product ? fmtMoney(product.price, product.currency, lang) : '...'}</span>
        </div>

        <h2 className="label">{t('payTitle')}</h2>
        <div className="methods">
          {METHODS.map((m) => (
            <button key={m.id} type="button" className="method" disabled={busy !== null} aria-busy={busy === m.id}
              onClick={() => pay(m.id)}>
              <span className="mi"><Icon name={m.icon} /></span>
              <span className="mt"><b>{t(m.title)}</b><small>{t(m.sub)}</small></span>
              {busy === m.id && <span className="spin" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <p className="muted small">{t('sandboxNote')}</p>
      </div>
    </div>
  );
}
