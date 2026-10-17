import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CashOrder, MomoOrder, Product } from '../api/types';
import { useI18n } from '../i18n-context';
import { DEFAULT_LANGS, fmtMoney } from '../lib/i18n';
import { KEYS, setItem } from '../lib/storage';

interface Props {
  onCash: (o: CashOrder) => void;
  onMomo: (o: MomoOrder) => void;
  onError: (text: string) => void;
}

/** Bước 1: chọn ngôn ngữ + hình thức thanh toán, tạo đơn. */
export function PayScreen({ onCash, onMomo, onError }: Props) {
  const { t, lang, setLang } = useI18n();
  const [product, setProduct] = useState<Product | null>(null);
  const [priceErr, setPriceErr] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const fail = (code: string | null) => onError(`${t('errPayment')} (${code})`);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch { onError(t('networkError')); } finally { setBusy(false); }
  }

  const payOnline = () => run(async () => {
    const r = await api.createOnline(productCode, lang);
    if (r.status !== 201 || !r.data) return fail(r.code);
    setItem(KEYS.pendingAuth, r.data.authCode, 'session');
    // Sang trang thanh toán (mock Payoo); xong sẽ quay về /payment/return?auth_code=...
    window.location.href = r.data.paymentUrl;
  });
  const payMomo = () => run(async () => {
    const r = await api.createMomo(productCode, lang);
    if (r.status !== 201 || !r.data) return fail(r.code);
    onMomo(r.data);
  });
  const payCash = () => run(async () => {
    const r = await api.createCash(productCode, lang);
    if (r.status !== 201 || !r.data) return fail(r.code);
    onCash(r.data);
  });

  return (
    <section>
      <h1>{t('payHeading')}</h1>
      <p>{t('payIntro')}</p>

      <div className="card">
        <div className="muted">{t('ticketTitle')}</div>
        <div className="price">
          {product ? `${fmtMoney(product.price, product.currency)} · ${t('validFor', { h: product.validity_hours })}`
            : priceErr ? t('networkError') : '...'}
        </div>
      </div>

      <h2 className="label">{t('chooseLang')}</h2>
      <div className="chips">
        {DEFAULT_LANGS.map((l) => (
          <button key={l.code} className={`chip${l.code === lang ? ' active' : ''}`} onClick={() => setLang(l.code)}>
            {l.nativeName}
          </button>
        ))}
      </div>

      <h2 className="label">{t('choosePay')}</h2>
      <button className="btn primary" disabled={busy} onClick={payOnline}>{t('payOnline')}</button>
      <button className="btn" disabled={busy} onClick={payMomo}>{t('payMomo')}</button>
      <button className="btn" disabled={busy} onClick={payCash}>{t('payCash')}</button>
      <p className="muted small">{t('mockNote')}</p>
    </section>
  );
}
