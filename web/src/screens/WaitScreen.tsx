import { useEffect, useState } from 'react';
import { api, sleep } from '../api/client';
import type { TokenRes } from '../api/types';
import { useI18n } from '../i18n-context';

const MAX_TRIES = 20;
const INTERVAL_MS = 3000;

interface Props {
  authCode: string;
  onToken: (t: TokenRes) => void;
  onInvalid: (code: string | null) => void;
  onTimeout: () => void;
}

/** Trang /payment/return: hỏi /auth/exchange mỗi 3 giây (202 = chưa trả xong, 200 = có token). */
export function WaitScreen({ authCode, onToken, onInvalid, onTimeout }: Props) {
  const { t, lang } = useI18n();
  const [attempt, setAttempt] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= MAX_TRIES && !cancelled; i++) {
        setAttempt(i);
        try {
          const r = await api.exchange(authCode, lang);
          if (cancelled) return;
          if (r.status === 200 && r.data) return onToken(r.data);
          if (r.status !== 202) return onInvalid(r.code);
        } catch { /* mất mạng: thử lại */ }
        await sleep(INTERVAL_MS);
      }
      if (!cancelled) onTimeout();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lại khi đổi authCode
  }, [authCode]);

  return (
    <div className="step center">
      <div className="tide" aria-hidden="true"><span style={{ transform: `scaleX(${attempt / MAX_TRIES})` }} /></div>
      <h1 className="serif">{t('waitTitle')}</h1>
      <p className="muted">{t('waitText')}</p>
    </div>
  );
}
