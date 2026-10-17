import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Dataset } from '../api/types';
import { getJson, KEYS, setItem } from '../lib/storage';

export type DatasetState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: Dataset }
  | { kind: 'empty' } // admin chưa publish (404)
  | { kind: 'error'; code: string };

/**
 * Tải dataset MỘT LẦN sau khi có token, gửi If-None-Match theo version đã lưu -> 304 thì dùng bản cũ.
 * Sau đó app chạy hoàn toàn trên dữ liệu này, không gọi API POI nữa.
 */
export function useDataset() {
  const [state, setState] = useState<DatasetState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const cached = getJson<Dataset>(KEYS.dataset);
    (async () => {
      try {
        const r = await api.dataset(cached?.version);
        if (cancelled) return;
        if (r.status === 200 && r.data) {
          setItem(KEYS.dataset, JSON.stringify(r.data));
          setState({ kind: 'ready', data: r.data });
        } else if (r.status === 304 && cached) setState({ kind: 'ready', data: cached });
        else if (r.status === 404) setState({ kind: 'empty' });
        else if (cached) setState({ kind: 'ready', data: cached });
        else setState({ kind: 'error', code: r.code ?? `HTTP_${r.status}` });
      } catch {
        if (cancelled) return;
        setState(cached ? { kind: 'ready', data: cached } : { kind: 'error', code: 'NETWORK' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
