import { LOCALE } from '../i18n';

/**
 * Phát thuyết minh: ưu tiên MP3 tạo sẵn (audioUrl do content-worker sinh), lỗi thì rơi về
 * giọng đọc của trình duyệt (Web Speech API). Chỉ một nguồn phát tại một thời điểm.
 * Trạng thái (đang phát điểm nào, tiến độ) được phát cho thanh phát qua subscribe().
 */
export interface NarrationState {
  poiId: string | null;
  playing: boolean;
  /** 0..1, MP3 theo thời gian; giọng trình duyệt theo số câu đã đọc */
  progress: number;
  source: 'audio' | 'voice' | null;
}

const IDLE: NarrationState = { poiId: null, playing: false, progress: 0, source: null };
let state = IDLE;
const subs = new Set<(s: NarrationState) => void>();
const set = (patch: Partial<NarrationState>) => { state = { ...state, ...patch }; subs.forEach((f) => f(state)); };

export function subscribe(fn: (s: NarrationState) => void) {
  subs.add(fn);
  fn(state);
  return () => { subs.delete(fn); };
}

const hasTts = typeof window !== 'undefined' && 'speechSynthesis' in window;
let voices: SpeechSynthesisVoice[] = [];
if (hasTts) {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load();
  speechSynthesis.onvoiceschanged = load;
}

const player = typeof Audio !== 'undefined' ? new Audio() : null;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let token = 0; // mỗi lần phát/dừng tăng lên để callback cũ tự bỏ qua

function voiceFor(bcp: string) {
  const pre = bcp.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === bcp.toLowerCase())
    ?? voices.find((v) => v.lang.toLowerCase().startsWith(pre));
}

/** Chia văn bản thành đoạn ngắn: Chrome Android hay tự dừng khi một utterance quá dài. */
export function chunkText(text: string, max = 180): string[] {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function speak(poiId: string | null, text: string, lang: string): boolean {
  if (!hasTts) return false;
  const bcp = LOCALE[lang] ?? 'en-US';
  const voice = voiceFor(bcp);
  if (!voice && voices.length) return false;
  halt();
  const my = token;
  const parts = chunkText(text);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = bcp;
    u.rate = 0.95;
    if (voice) u.voice = voice;
    u.onend = () => {
      if (my !== token) return;
      if (i === parts.length - 1) set(IDLE); else set({ progress: (i + 1) / parts.length });
    };
    u.onerror = () => { if (my === token) set(IDLE); };
    speechSynthesis.speak(u);
  });
  set({ poiId, playing: true, progress: 0, source: 'voice' });
  return true;
}

if (player) {
  player.ontimeupdate = () => {
    if (state.source === 'audio' && player.duration) set({ progress: player.currentTime / player.duration });
  };
}

function halt() {
  token++;
  if (player) { player.onended = null; player.onerror = null; player.pause(); }
  if (hasTts) speechSynthesis.cancel();
}

/** Phát MP3 nếu có, lỗi thì giọng trình duyệt; không phát được gì thì gọi onNoVoice. */
export function narrate(poiId: string | null, text: string, lang: string, audioUrl: string | null | undefined, onNoVoice: () => void) {
  const fallback = () => { if (!speak(poiId, text, lang)) { set(IDLE); onNoVoice(); } };
  if (!audioUrl || !player) { fallback(); return; }
  halt();
  const my = token;
  player.onended = () => { if (my === token) set(IDLE); };
  player.onerror = () => { if (my === token) fallback(); };
  player.src = audioUrl;
  set({ poiId, playing: true, progress: 0, source: 'audio' });
  player.play().catch(() => { if (my === token) fallback(); });
}

export function stop() {
  halt();
  set(IDLE);
}

/** iOS/Android chỉ cho phát âm thanh sau một thao tác chạm: gọi trong onClick để "mở khóa". */
export function unlockAudio(sayText?: string, lang?: string) {
  if (player) { player.src = SILENT; player.play().catch(() => {}); }
  if (sayText && lang) speak(null, sayText, lang);
}
