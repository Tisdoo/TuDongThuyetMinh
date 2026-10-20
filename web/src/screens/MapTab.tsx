import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { Circle, CircleMarker, LayersControl, MapContainer, Marker, Polyline, TileLayer, ZoomControl, useMapEvents } from 'react-leaflet';
import { Icon } from '../components/Icon';
import { PoiList } from '../components/PoiList';
import { SIM_ENABLED, useGuide } from '../guide-context';
import { useI18n } from '../i18n-context';
import type { Fix } from '../lib/geofence';
import { categoryOf, poiContent, poiName } from '../lib/poi';

const DEFAULT_CENTER: [number, number] = [16.1, 108.277]; // Chùa Linh Ứng Bãi Bụt, Sơn Trà

const iconCache = new Map<string, L.DivIcon>();
function pinIcon(cat: string, near: boolean, selected: boolean) {
  const key = `${cat}-${near}-${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<span class="pin c-${cat.toLowerCase()}${near ? ' near' : ''}${selected ? ' sel' : ''}"></span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/** Chế độ giả lập: chạm bản đồ = "đi" tới đó (thử geofence khi không ở chùa). */
function SimClick({ enabled, onFix }: { enabled: boolean; onFix: (f: Fix) => void }) {
  useMapEvents({ click: (e) => { if (enabled) onFix({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 5 }); } });
  return null;
}

export function MapTab({ active }: { active: boolean }) {
  const { t, lang } = useI18n();
  const g = useGuide();
  const [map, setMap] = useState<L.Map | null>(null);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(false);
  const focus = g.pois.find((p) => p.id === g.focusId) ?? null;

  const [fitted, setFitted] = useState(false);

  // Tab bị ẩn thì Leaflet không biết kích thước: đo lại mỗi khi hiện, rồi mới căn khung / bay tới điểm
  useEffect(() => {
    if (!active || !map) return;
    const id = window.setTimeout(() => {
      map.invalidateSize();
      if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
      else if (!fitted && g.pois.length) {
        map.fitBounds(g.pois.map((p) => [p.lat, p.lng] as [number, number]), { padding: [48, 48], maxZoom: 18 });
        setFitted(true);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, map, focus, fitted, g.pois]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const l = s
      ? g.pois.filter((p) => [poiName(p, lang), poiContent(p, lang).c?.shortDescription ?? ''].join(' ').toLowerCase().includes(s))
      : g.pois;
    return g.fix ? [...l].sort((a, b) => (g.distances.get(a.id) ?? 0) - (g.distances.get(b.id) ?? 0)) : l;
  }, [q, g.pois, g.fix, g.distances, lang]);

  function locate() {
    if (g.fix && map) map.flyTo([g.fix.lat, g.fix.lng], 18, { duration: 0.6 });
    else g.toast(g.gpsError === 'denied' ? t('gpsDenied') : t('gpsWeak'));
  }

  return (
    <div className="maptab">
      <div className="mapcanvas">
        <MapContainer ref={setMap} center={DEFAULT_CENTER} zoom={16} zoomControl={false} className="map">
          <LayersControl key={lang} position="topleft">
            <LayersControl.BaseLayer checked name={t('layerMap')}>
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="&copy; OpenStreetMap" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t('layerSat')}>
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} attribution="Esri" />
            </LayersControl.BaseLayer>
          </LayersControl>
          <ZoomControl position="bottomright" />
          <SimClick enabled={g.simOn} onFix={g.setFix} />

          {g.pois.map((p) => (
            <Circle key={`r-${p.id}`} center={[p.lat, p.lng]} radius={p.triggerRadiusM}
              pathOptions={{ color: '#2A6B73', weight: 1, fillColor: '#2A6B73', fillOpacity: 0.07, dashArray: '3 4' }} />
          ))}
          {g.pois.map((p) => {
            const d = g.distances.get(p.id);
            return (
              <Marker key={p.id} position={[p.lat, p.lng]} title={poiName(p, lang)} keyboard
                icon={pinIcon(categoryOf(p, g.dataset), d !== undefined && d <= p.triggerRadiusM, focus?.id === p.id || g.selected?.id === p.id)}
                eventHandlers={{ click: () => g.openPoi(p) }} />
            );
          })}

          {g.fix && <>
            <Circle center={[g.fix.lat, g.fix.lng]} radius={Math.min(g.fix.accuracy, 300)} pathOptions={{ color: '#2563EB', weight: 1, fillOpacity: 0.08 }} />
            <CircleMarker center={[g.fix.lat, g.fix.lng]} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }} />
          </>}
          {g.fix && focus && (
            <Polyline positions={[[g.fix.lat, g.fix.lng], [focus.lat, focus.lng]]} pathOptions={{ color: '#0F3B44', weight: 2.5, dashArray: '2 7', lineCap: 'round' }} />
          )}
        </MapContainer>

        <div className="mapfabs">
          <button type="button" className="fab" aria-label={t('locate')} title={t('locate')} onClick={locate}><Icon name="locate" /></button>
          <button type="button" className={`fab${g.autoplay ? ' on' : ''}`} role="switch" aria-checked={g.autoplay}
            aria-label={t('autoTitle')} title={t('autoTitle')} onClick={g.toggleAutoplay}><Icon name="auto" /></button>
          {SIM_ENABLED && (
            <button type="button" className={`fab${g.simOn ? ' on' : ''}`} aria-label="GPS sim" title="GPS sim" onClick={g.toggleSim}><Icon name="sim" /></button>
          )}
        </div>
      </div>

      <aside className={`mappanel${expanded ? ' open' : ''}`}>
        <button type="button" className="grip" aria-label={t('poisTitle')} aria-expanded={expanded} onClick={() => setExpanded((e) => !e)} />
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" value={q} placeholder={t('searchPh')} onChange={(e) => setQ(e.target.value)}
            onFocus={() => setExpanded(true)} aria-label={t('searchPh')} />
        </label>
        {list.length ? <PoiList pois={list} compact /> : <p className="empty">{g.pois.length ? t('noMatch') : t('noPoi')}</p>}
      </aside>
    </div>
  );
}
