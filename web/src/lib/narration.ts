import { TTS_LANG } from './i18n';

/**
 * Phát thuyết minh: ưu tiên MP3 tạo sẵn (audioUrl do content-worker sinh), lỗi thì rơi về
 * giọng đọc của trình duyệt (Web Speech API). Chỉ một nguồn phát tại một thời điểm.
 */
type Listener = (speaking: boolean) => void;

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
let listener: Listener = () => {};

export const onSpeakingChange = (fn: Listener) => { listener = fn; };
const setSpeaking = (on: boolean) => listener(on);

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

/** Đọc bằng giọng trình duyệt. Trả false nếu thiết bị không có giọng cho ngôn ngữ này. */
export function speak(text: string, lang: string): boolean {
  if (!hasTts) return false;
  const bcp = TTS_LANG[lang] ?? 'en-US';
  const voice = voiceFor(bcp);
  if (!voice && voices.length) return false;
  stop();
  const my = token;
  const parts = chunkText(text);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = bcp;
    u.rate = 0.95;
    if (voice) u.voice = voice;
    if (i === parts.length - 1) u.onend = () => { if (my === token) setSpeaking(false); };
    u.onerror = () => { if (my === token) setSpeaking(false); };
    speechSynthesis.speak(u);
  });
  setSpeaking(true);
  return true;
}

/** Phát MP3; lỗi (chưa có file, mạng yếu) thì gọi onFail để rơi về giọng trình duyệt. */
export function playAudio(url: string, onFail: () => void) {
  if (!player) { onFail(); return; }
  stop();
  const my = token;
  player.onended = () => { if (my === token) setSpeaking(false); };
  player.onerror = () => { if (my === token) onFail(); };
  player.src = url;
  setSpeaking(true);
  player.play().catch(() => { if (my === token) onFail(); });
}

/** Phát MP3 nếu có, không thì giọng trình duyệt; không phát được gì thì gọi onNoVoice. */
export function narrate(text: string, lang: string, audioUrl: string | null | undefined, onNoVoice: () => void) {
  const fallback = () => { if (!speak(text, lang)) { setSpeaking(false); onNoVoice(); } };
  if (audioUrl) playAudio(audioUrl, fallback); else fallback();
}

export function stop() {
  token++;
  if (player) { player.onended = null; player.onerror = null; player.pause(); }
  if (hasTts) speechSynthesis.cancel();
  setSpeaking(false);
}

/** iOS/Android chỉ cho phát âm thanh sau một thao tác chạm: gọi hàm này trong onClick để "mở khóa". */
export function unlockAudio(sayText?: string, lang?: string) {
  if (player) { player.src = SILENT; player.play().catch(() => {}); }
  if (sayText && lang) speak(sayText, lang);
}
