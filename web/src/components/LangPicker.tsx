import { useI18n } from '../i18n-context';
import { LANGS } from '../i18n';

/** Lưới chọn ngôn ngữ, ghi tên bằng chính ngôn ngữ đó để khách nước ngoài nhận ra. */
export function LangPicker({ onPick }: { onPick?: () => void }) {
  const { lang, setLang } = useI18n();
  return (
    <div className="langs" role="radiogroup">
      {LANGS.map((l) => (
        <button key={l.code} type="button" role="radio" aria-checked={l.code === lang} lang={l.code}
          className={l.code === lang ? 'on' : ''} onClick={() => { setLang(l.code); onPick?.(); }}>
          {l.nativeName}
        </button>
      ))}
    </div>
  );
}
