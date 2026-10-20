import { useGuide, type Tab } from '../guide-context';
import { useI18n } from '../i18n-context';
import { Icon, type IconName } from './Icon';

const TABS: Array<{ id: Tab; icon: IconName; key: 'tabHome' | 'tabMap' | 'tabTicket' }> = [
  { id: 'home', icon: 'home', key: 'tabHome' },
  { id: 'map', icon: 'map', key: 'tabMap' },
  { id: 'ticket', icon: 'ticket', key: 'tabTicket' },
];

export function TabBar() {
  const { t } = useI18n();
  const { tab, setTab } = useGuide();
  return (
    <nav className="tabbar" aria-label="Menu">
      {TABS.map((x) => (
        <button key={x.id} type="button" className={tab === x.id ? 'on' : ''} aria-current={tab === x.id ? 'page' : undefined}
          onClick={() => setTab(x.id)}>
          <Icon name={x.icon} />
          <span>{t(x.key)}</span>
        </button>
      ))}
    </nav>
  );
}
