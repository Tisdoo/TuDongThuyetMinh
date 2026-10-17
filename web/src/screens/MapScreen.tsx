import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, LayersControl, MapContainer, Marker, Polyline, TileLayer, ZoomControl, useMapEvents } from 'react-leaflet';
import type { Dataset, Language, Poi } from '../api/types';
import { ChatPanel } from '../components/ChatPanel';
import { PoiSheet } from '../components/PoiSheet';
import { useDataset } from '../hooks/useDataset';
import { useGeolocation } from '../hooks/useGeolocation';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n-context';
import { GeofenceEngine, haversineM, type Fix } from '../lib/geofence';
import * as narration from '../lib/narration';
import { narrationText, poiContent, poiName } from '../lib/poi';

const DEFAULT_CENTER: [number, number] = [16.1, 108.277]; // Chùa Linh Ứng Bãi Bụt, Sơn Trà
const NEAR_M = 100; // POI trong 100 m được tô xanh
const SIM_ENABLED = new URLSearchParams(window.location.search).get('sim') === '1';

const iconCache = new Map<string, L.DivIcon>();
function pinIcon(n: number, near: boolean) {
  const key = `${n}-${near}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({ className: '', html: `<div class="pin${near ? ' near' : ''}">${n}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    iconCache.set(key, icon);
  }
  return icon;
}

/** Chế độ giả lập: chạm bản đồ = "đi" tới đó (thử geofence khi không ở chùa). */
function SimClick({ enabled, onFix }: { enabled: boolean; onFix: (f: Fix) => void }) {
  useMapEvents({ click: (e) => { if (enabled) onFix({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 5 }); } });
  return null;
}

export function MapScreen({ onLanguages }: { onLanguages: (l: Language[]) => void }) {
  const { t } = useI18n();
  const ds = useDataset();
  const dataset: Dataset | null = ds.kind === 'ready' ? ds.data : null;

  useEffect(() => { if (dataset?.languages?.length) onLanguages(dataset.languages); }, [dataset, onLanguages]);

  if (ds.kind === 'loading') return <div className="mapmsg">{t('mapLoading')}</div>;
  if (ds.kind === 'error') return <div className="mapmsg">{ds.code === 'NETWORK' ? t('networkError') : `${t('errTitle')} (${ds.code})`}</div>;
  return <GuideMap pois={dataset?.pois ?? []} languages={dataset?.languages ?? []} emptyMsg={ds.kind === 'empty' ? t('noDataset') : t('noPoi')} />;
}

function GuideMap({ pois, languages, emptyMsg }: { pois: Poi[]; languages: Language[]; emptyMsg: string }) {
  const { t, lang } = useI18n();
  const { msg: toastMsg, toast } = useToast();
  const [map, setMap] = useState<L.Map | null>(null);
  const [simOn, setSimOn] = useState(false);
  const { fix, setFix, error: gpsError } = useGeolocation(simOn);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [banner, setBanner] = useState<Poi | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const firstFix = useRef(true);

  const engine = useMemo(() => new GeofenceEngine(pois), [pois]);

  useEffect(() => { narration.onSpeakingChange(setSpeaking); return () => narration.stop(); }, []);
  useEffect(() => { narration.stop(); }, [lang]); // đổi ngôn ngữ thì dừng giọng cũ

  // Vừa vào bản đồ: nhìn bao quát tất cả POI
  useEffect(() => {
    if (!map || !pois.length) return;
    map.fitBounds(pois.map((p) => [p.lat, p.lng] as [number, number]), { padding: [40, 40], maxZoom: 18 });
  }, [map, pois]);

  useEffect(() => {
    if (gpsError === 'denied') toast(t('gpsDenied'), 6000);
    else if (gpsError === 'weak') toast(t('gpsWeak'));
    else if (gpsError === 'unsupported') toast(t('gpsUnsupported'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsError]);

  const listen = useCallback((poi: Poi) => {
    const { c, code } = poiContent(poi, lang);
    if (!c || !code) return;
    narration.narrate(narrationText(c), code, c.audioUrl, () => toast(t('noVoice')));
  }, [lang, t, toast]);

  const openPoi = useCallback((poi: Poi) => {
    narration.stop();
    setSelected(poi);
    setBanner(null);
    map?.panTo([poi.lat, poi.lng]);
  }, [map]);

  // Mỗi fix GPS (thật hoặc giả lập): chạy geofence, gợi ý / tự phát khi vào vùng POI
  useEffect(() => {
    if (!fix || !map) return;
    if (firstFix.current) {
      firstFix.current = false;
      const nearest = Math.min(...pois.map((p) => haversineM(fix, p)));
      if (nearest < 2000) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17));
      else if (Number.isFinite(nearest)) toast(t('farAway', { km: (nearest / 1000).toFixed(1) }));
    }
    const hit = engine.update(fix);
    if (!hit) return;
    if (autoplay) { openPoi(hit); listen(hit); } else setBanner(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng theo vị trí mới
  }, [fix, map]);

  // Banner gợi ý tự ẩn sau 15 giây
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 15000);
    return () => window.clearTimeout(id);
  }, [banner]);

  const distances = useMemo(() => {
    const m = new Map<string, number>();
    if (fix) for (const p of pois) m.set(p.id, haversineM(fix, p));
    return m;
  }, [fix, pois]);

  function toggleAuto() {
    const on = !autoplay;
    setAutoplay(on);
    toast(on ? t('autoOn') : t('autoOff'));
    // Phải gọi trong thao tác chạm để iOS cho phép phát tự động về sau
    if (on) narration.unlockAudio(t('autoOnSpeech'), lang);
  }
  function toggleSim() {
    const on = !simOn;
    setSimOn(on);
    toast(on ? t('simOn') : t('simOff'));
  }
  function locate() {
    if (fix && map) map.setView([fix.lat, fix.lng], 18); else toast(t('gpsWeak'));
  }

  return (
    <div className="mapwrap">
      <MapContainer ref={setMap} center={DEFAULT_CENTER} zoom={16} zoomControl={false} className="map">
        <LayersControl key={lang} position="topright">
          <LayersControl.BaseLayer checked name={t('mapLayer')}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="&copy; OpenStreetMap" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name={t('satLayer')}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} attribution="Esri" />
          </LayersControl.BaseLayer>
        </LayersControl>
        <ZoomControl position="bottomright" />
        <SimClick enabled={simOn} onFix={setFix} />

        {pois.map((p, i) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(i + 1, (distances.get(p.id) ?? Infinity) <= NEAR_M)}
            title={poiName(p, lang)} eventHandlers={{ click: () => openPoi(p) }} />
        ))}
        {pois.map((p) => (
          <Circle key={`r-${p.id}`} center={[p.lat, p.lng]} radius={p.triggerRadiusM} pathOptions={{ color: '#b91c1c', weight: 1, fillOpacity: 0.08 }} />
        ))}

        {fix && <>
          <Circle center={[fix.lat, fix.lng]} radius={Math.min(fix.accuracy, 300)} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.1 }} />
          <CircleMarker center={[fix.lat, fix.lng]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }} />
        </>}
        {fix && selected && (
          <Polyline positions={[[fix.lat, fix.lng], [selected.lat, selected.lng]]} pathOptions={{ color: '#2563eb', weight: 3, dashArray: '6 8' }} />
        )}
      </MapContainer>

      {!pois.length && <div className="mapmsg">{emptyMsg}</div>}

      <div className="fabs">
        <button className="fab" title={t('locate')} aria-label={t('locate')} onClick={locate}>&#9678;</button>
        <button className={`fab${autoplay ? ' on' : ''}`} title={autoplay ? t('autoOn') : t('autoOff')} aria-label={t('autoOff')} onClick={toggleAuto}>&#128266;</button>
        <button className="fab" title={t('chatTitle')} aria-label={t('chatTitle')} onClick={() => setChatOpen((o) => !o)}>&#128172;</button>
        {SIM_ENABLED && <button className={`fab${simOn ? ' on' : ''}`} title="GPS sim" aria-label="GPS sim" onClick={toggleSim}>&#129514;</button>}
      </div>

      {banner && (
        <div className="banner">
          <span>{t('nearYou')} <strong>{poiName(banner, lang)}</strong></span>
          <button className="btn primary small" onClick={() => { const p = banner; openPoi(p); listen(p); }}>{t('listen')}</button>
          <button className="x" aria-label="close" onClick={() => setBanner(null)}>&times;</button>
        </div>
      )}

      {selected && (
        <PoiSheet
          poi={selected} languages={languages} distanceM={distances.get(selected.id) ?? null} speaking={speaking}
          onListen={() => listen(selected)} onStop={narration.stop}
          onClose={() => { narration.stop(); setSelected(null); }}
        />
      )}

      {chatOpen && <ChatPanel poiId={selected?.id} onClose={() => setChatOpen(false)} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
