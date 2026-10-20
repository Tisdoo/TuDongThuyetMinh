import { HeroArt } from '../components/HeroArt';
import { useI18n } from '../i18n-context';
import { fmtTime, type I18nKey } from '../i18n';
import { languageName } from '../lib/poi';
import { getTicket } from '../lib/ticket';

/** Vé đang dùng: hạn dùng, mã đơn để đưa nhân viên khi cần, kết thúc phiên. */
export function TicketTab({ onEnd }: { onEnd: () => void }) {
  const { t, lang } = useI18n();
  const ticket = getTicket();
  const exp = ticket?.expiresAt ? new Date(ticket.expiresAt) : null;
  const valid = !exp || exp.getTime() > Date.now();

  return (
    <div className="tickettab">
      <div className="pass">
        <div className="pass-top">
          <HeroArt className="pass-art" />
          <div className="pass-head">
            <span>{t('ticketTitle')}</span>
            <b className="serif">{t('place')}</b>
          </div>
        </div>
        <div className="pass-tear" aria-hidden="true" />
        <dl className="pass-body">
          <div className="wide">
            <dt>{valid ? t('validUntil') : t('ticketExpiredTitle')}</dt>
            <dd className="big">{exp ? fmtTime(exp, lang) : '—'}</dd>
          </div>
          {ticket?.orderCode && <div><dt>{t('orderCode')}</dt><dd className="code">{ticket.orderCode}</dd></div>}
          {ticket?.method && <div><dt>{t('method')}</dt><dd>{t(`method_${ticket.method}` as I18nKey)}</dd></div>}
          <div><dt>{t('language')}</dt><dd>{languageName(lang, undefined)}</dd></div>
        </dl>
      </div>
      <p className="muted small">{valid ? t('ticketHelp') : t('ticketExpired')}</p>
      <button type="button" className="btn danger wide" onClick={() => { if (window.confirm(t('endConfirm'))) onEnd(); }}>
        {t('endSession')}
      </button>
    </div>
  );
}
