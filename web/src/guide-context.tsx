import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset, Poi } from './api/types';
import { useDataset, type DatasetState } from './hooks/useDataset';
import { useGeolocation, type GpsError } from './hooks/useGeolocation';
import { useToast } from './hooks/useToast';
import { useI18n } from './i18n-context';
import { GeofenceEngine, haversineM, type Fix } from './lib/geofence';
import * as narration from './lib/narration';
import { narrationText, poiContent } from './lib/poi';
import { getItem, KEYS, setItem } from './lib/storage';

export type Tab = 'home' | 'map' | 'ticket';
export const SIM_ENABLED = new URLSearchParams(window.location.search).get('sim') === '1';

interface GuideCtx {
  ds: DatasetState;
  dataset: Dataset | null;
  pois: Poi[];
  tab: Tab;
  setTab: (t: Tab) => void;
  fix: Fix | null;
  setFix: (f: Fix) => void;
  gpsError: GpsError;
  distances: Map<string, number>;
  selected: Poi | null;
  openPoi: (p: Poi) => void;
  closePoi: () => void;
  /** Mở tab Bản đồ và đưa điểm vào giữa */
  focusOnMap: (p: Poi) => void;
  focusId: string | null;
  listen: (p: Poi) => void;
  stopNarration: () => void;
  narr: narration.NarrationState;
  autoplay: boolean;
  toggleAutoplay: () => void;
  simOn: boolean;
  toggleSim: () => void;
  banner: Poi | null;
  dismissBanner: () => void;
  toastMsg: string | null;
  toast: (m: string, ms?: number) => void;
}
const Ctx = createContext<GuideCtx | null>(null);

/** Trạng thái dùng chung của phần hướng dẫn (sau khi có vé): dữ liệu, vị trí, geofence, phát thuyết minh. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const ds = useDataset();
  const dataset = ds.kind === 'ready' ? ds.data : null;
  const pois = useMemo(() => dataset?.pois ?? [], [dataset]);
  const [tab, setTab] = useState<Tab>('home');
  const [simOn, setSimOn] = useState(false);
  const { fix, setFix, error: gpsError } = useGeolocation(simOn);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Poi | null>(null);
  const [autoplay, setAutoplay] = useState(() => getItem(KEYS.autoplay) === '1');
  const [narr, setNarr] = useState<narration.NarrationState>({ poiId: null, playing: false, progress: 0, source: null });
  const { msg: toastMsg, toast } = useToast();
  const warnedFar = useRef(false);

  const engine = useMemo(() => new GeofenceEngine(pois), [pois]);
  useEffect(() => narration.subscribe(setNarr), []);
  useEffect(() => () => narration.stop(), []);
  useEffect(() => { narration.stop(); }, [lang]); // đổi ngôn ngữ thì dừng giọng cũ

  const listen = useCallback((poi: Poi) => {
    const { c, code } = poiContent(poi, lang);
    if (!c || !code) return;
    narration.narrate(poi.id, narrationText(c), code, c.audioUrl, () => toast(t('noVoice')));
  }, [lang, t, toast]);

  const openPoi = useCallback((p: Poi) => { setSelected(p); setBanner(null); }, []);
  const closePoi = useCallback(() => setSelected(null), []);
  const focusOnMap = useCallback((p: Poi) => { setSelected(null); setFocusId(p.id); setTab('map'); }, []);

  // Mỗi vị trí mới (GPS thật hoặc giả lập): chạy geofence, gợi ý hoặc tự phát khi vào vùng một điểm
  useEffect(() => {
    if (!fix || !pois.length) return;
    if (!warnedFar.current) {
      warnedFar.current = true;
      const nearest = Math.min(...pois.map((p) => haversineM(fix, p)));
      if (nearest > 2000) toast(t('farAway', { km: (nearest / 1000).toFixed(1) }));
    }
    const hit = engine.update(fix);
    if (!hit) return;
    if (autoplay) { setSelected(hit); listen(hit); } else setBanner(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng theo vị trí mới
  }, [fix, engine]);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 15000);
    return () => window.clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    if (gpsError === 'weak') toast(t('gpsWeak'));
    else if (gpsError === 'unsupported') toast(t('gpsUnsupported'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsError]);

  const distances = useMemo(() => {
    const m = new Map<string, number>();
    if (fix) for (const p of pois) m.set(p.id, haversineM(fix, p));
    return m;
  }, [fix, pois]);

  const toggleAutoplay = useCallback(() => {
    setAutoplay((on) => {
      const next = !on;
      setItem(KEYS.autoplay, next ? '1' : '0');
      toast(next ? t('autoOn') : t('autoOff'));
      // Gọi trong thao tác chạm để iOS cho phép phát tự động về sau
      if (next) narration.unlockAudio(t('autoSpeech'), lang);
      return next;
    });
  }, [lang, t, toast]);

  const toggleSim = useCallback(() => {
    setSimOn((on) => { toast(on ? t('simOff') : t('simOn')); return !on; });
  }, [t, toast]);

  const value: GuideCtx = {
    ds, dataset, pois, tab, setTab, fix, setFix, gpsError, distances, selected, openPoi, closePoi,
    focusOnMap, focusId, listen, stopNarration: narration.stop, narr, autoplay, toggleAutoplay, simOn, toggleSim,
    banner, dismissBanner: () => setBanner(null), toastMsg, toast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuide(): GuideCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGuide must be used inside GuideProvider');
  return v;
}

/** "120 m" hoặc "1,4 km" theo ngôn ngữ */
export function useDistanceLabel() {
  const { t } = useI18n();
  return (m: number | undefined) => {
    if (m === undefined) return '';
    return m < 1000 ? t('distM', { m: Math.round(m) }) : t('distKm', { km: (m / 1000).toFixed(1) });
  };
}
