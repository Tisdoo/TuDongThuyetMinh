import { useState } from 'react';
import { useI18n } from '../i18n-context';
import { Icon } from './Icon';

/** Mã lớn để đưa nhân viên đọc, kèm nút sao chép. */
export function CodeStub({ code, label }: { code: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* trình duyệt chặn */ }
  }
  return (
    <div className="stub">
      <span className="stub-label">{label}</span>
      <span className="stub-code">{code}</span>
      <button type="button" className="btn ghost sm" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}
