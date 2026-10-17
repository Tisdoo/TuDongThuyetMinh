// Chuỗi giao diện. Ngôn ngữ nội dung POI lấy từ dataset.languages; giao diện có vi/en, ngôn ngữ khác dùng en.
const vi = {
  title: 'Thuyết minh Chùa Linh Ứng', payHeading: 'Mở khóa hướng dẫn',
  payIntro: 'Thanh toán vé để nghe thuyết minh tự động theo vị trí của bạn.',
  ticketTitle: 'Vé tham quan', validFor: 'có hiệu lực {h} giờ',
  chooseLang: 'Ngôn ngữ thuyết minh', choosePay: 'Hình thức thanh toán',
  payOnline: 'Thanh toán online', payMomo: 'Thanh toán MoMo (quét QR)', payCash: 'Thanh toán tiền mặt tại quầy',
  mockNote: 'Chế độ thử nghiệm: thanh toán online là giả lập.',
  waitTitle: 'Đang xác nhận thanh toán', waitText: 'Vui lòng đợi trong giây lát...',
  waitFailTitle: 'Chưa xác nhận được', waitFailText: 'Hệ thống chưa nhận được kết quả. Hãy thử lại hoặc liên hệ nhân viên.',
  retry: 'Thử lại', cashTitle: 'Thanh toán tiền mặt', cashStep1: 'Đưa mã đơn này cho nhân viên và trả tiền:',
  cashWaiting: 'Đang chờ nhân viên xác nhận...', cashPaid: 'Đã thu tiền. Hãy nhập mã nhân viên đọc cho bạn.',
  cashExpired: 'Đơn đã hết hạn hoặc bị hủy. Hãy tạo đơn mới.', cashStep2: 'Nhập mã truy cập do nhân viên đọc:',
  submit: 'Xác nhận', codeInvalid: 'Mã sai hoặc đã hết hạn.', codeLocked: 'Bạn nhập sai quá nhiều lần. Thử lại sau 5 phút.',
  cashNotYet: 'Chưa thu tiền, vui lòng chờ.', back: 'Quay lại', errTitle: 'Có lỗi xảy ra',
  errPayment: 'Không tạo được đơn thanh toán.', errCode: 'Mã thanh toán không hợp lệ hoặc đã hết hạn.',
  payFailTitle: 'Thanh toán không thành công', payFailText: 'Bạn chưa bị trừ tiền. Hãy thử lại.', payAgain: 'Thanh toán lại',
  networkError: 'Không kết nối được máy chủ.', mapLoading: 'Đang tải dữ liệu...',
  noDataset: 'Chưa có dữ liệu thuyết minh. Quản trị viên cần publish dataset.', noPoi: 'Chưa có điểm tham quan nào.',
  listen: 'Nghe thuyết minh', stop: 'Dừng', directions: 'Chỉ đường', nearYou: 'Bạn đang gần',
  gpsDenied: 'Bạn chưa cho phép định vị. Bản đồ vẫn dùng được, hãy chạm vào điểm để xem.', gpsWeak: 'Tín hiệu GPS yếu.',
  gpsUnsupported: 'Thiết bị không hỗ trợ định vị.',
  farAway: 'Bạn đang cách chùa khoảng {km} km.', noVoice: 'Thiết bị chưa có giọng đọc cho ngôn ngữ này, hãy đọc văn bản.',
  autoOn: 'Tự động phát: bật', autoOff: 'Tự động phát: tắt', autoOnSpeech: 'Đã bật tự động thuyết minh',
  fallbackNote: 'Chưa có bản dịch, hiển thị bằng {lang}.', distAway: 'Cách bạn {m} m',
  simOn: 'Giả lập vị trí: bật. Chạm lên bản đồ để di chuyển.', simOff: 'Giả lập vị trí: tắt', locate: 'Vị trí của tôi',
  momoTitle: 'Thanh toán bằng MoMo', momoStep1: 'Mở MoMo, quét mã QR bên dưới và chuyển đúng số tiền.',
  momoNote: 'Ghi nội dung chuyển tiền là:', momoWaiting: 'Đang chờ nhân viên xác nhận đã nhận tiền...',
  momoHint: 'Sau khi chuyển, giữ nguyên màn hình này. Ứng dụng sẽ tự mở khi nhân viên xác nhận.',
  momoExpired: 'Đơn đã hết hạn hoặc không hợp lệ.', audioPre: 'Audio tạo sẵn', audioLocal: 'Giọng đọc của trình duyệt',
  chatTitle: 'Hỏi đáp về chùa', chatPlaceholder: 'Đặt câu hỏi...', chatSend: 'Gửi', chatUnavailable: 'Trợ lý hỏi đáp chưa sẵn sàng.',
  chatHello: 'Xin chào! Bạn muốn biết gì về Chùa Linh Ứng?', chatError: 'Không trả lời được, hãy thử lại.',
  logout: 'Thoát phiên', mapLayer: 'Bản đồ', satLayer: 'Vệ tinh',
};
type Dict = typeof vi;
const en: Dict = {
  title: 'Linh Ung Pagoda Guide', payHeading: 'Unlock the guide',
  payIntro: 'Buy a ticket to hear automatic narration based on your location.',
  ticketTitle: 'Visitor ticket', validFor: 'valid for {h} hours',
  chooseLang: 'Narration language', choosePay: 'Payment method',
  payOnline: 'Pay online', payMomo: 'Pay with MoMo (scan QR)', payCash: 'Pay cash at the counter',
  mockNote: 'Test mode: online payment is simulated.',
  waitTitle: 'Confirming payment', waitText: 'Please wait a moment...',
  waitFailTitle: 'Not confirmed yet', waitFailText: 'No result received. Try again or ask the staff.',
  retry: 'Try again', cashTitle: 'Cash payment', cashStep1: 'Give this order code to the staff and pay:',
  cashWaiting: 'Waiting for staff confirmation...', cashPaid: 'Payment received. Enter the code the staff reads to you.',
  cashExpired: 'The order expired or was cancelled. Create a new one.', cashStep2: 'Enter the access code from the staff:',
  submit: 'Confirm', codeInvalid: 'Wrong or expired code.', codeLocked: 'Too many wrong attempts. Try again in 5 minutes.',
  cashNotYet: 'Payment not received yet, please wait.', back: 'Back', errTitle: 'Something went wrong',
  errPayment: 'Could not create the payment order.', errCode: 'The payment code is invalid or expired.',
  payFailTitle: 'Payment failed', payFailText: 'You have not been charged. Please try again.', payAgain: 'Pay again',
  networkError: 'Cannot reach the server.', mapLoading: 'Loading data...',
  noDataset: 'No guide data yet. An admin must publish the dataset.', noPoi: 'No points of interest yet.',
  listen: 'Listen', stop: 'Stop', directions: 'Directions', nearYou: 'You are near',
  gpsDenied: 'Location permission denied. The map still works, tap a point to read about it.', gpsWeak: 'Weak GPS signal.',
  gpsUnsupported: 'This device does not support location.',
  farAway: 'You are about {km} km from the pagoda.', noVoice: 'No voice for this language on your device, please read the text.',
  autoOn: 'Auto-play: on', autoOff: 'Auto-play: off', autoOnSpeech: 'Automatic narration enabled',
  fallbackNote: 'No translation yet, showing {lang}.', distAway: '{m} m away',
  simOn: 'Location simulation on. Tap the map to move.', simOff: 'Location simulation off', locate: 'My location',
  momoTitle: 'Pay with MoMo', momoStep1: 'Open MoMo, scan the QR code below and transfer the exact amount.',
  momoNote: 'Use this as the transfer message:', momoWaiting: 'Waiting for staff to confirm the payment...',
  momoHint: 'After transferring, keep this screen open. The app opens automatically once staff confirm.',
  momoExpired: 'The order expired or is invalid.', audioPre: 'Pre-generated audio', audioLocal: 'Browser voice',
  chatTitle: 'Ask about the pagoda', chatPlaceholder: 'Ask a question...', chatSend: 'Send', chatUnavailable: 'The Q&A assistant is not available yet.',
  chatHello: 'Hello! What would you like to know about Linh Ung Pagoda?', chatError: 'Could not answer, please try again.',
  logout: 'End session', mapLayer: 'Map', satLayer: 'Satellite',
};

export type I18nKey = keyof Dict;
export const isI18nKey = (k: string): k is I18nKey => k in vi;
const DICTS: Record<string, Dict> = { vi, en };

export const DEFAULT_LANGS = [
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'en', name: 'English', nativeName: 'English' },
];

/** Mã ngôn ngữ dùng cho SpeechSynthesisUtterance.lang */
export const TTS_LANG: Record<string, string> = { vi: 'vi-VN', en: 'en-US', 'zh-CN': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR' };

export function normalizeLang(l: string | undefined): string {
  const s = (l ?? '').toLowerCase();
  if (s.startsWith('vi')) return 'vi';
  if (s.startsWith('zh')) return 'zh-CN';
  for (const c of ['ja', 'ko', 'fr', 'en']) if (s.startsWith(c)) return c;
  return 'en';
}

export function translate(lang: string, key: I18nKey, vars?: Record<string, string | number>): string {
  let s = (DICTS[lang] ?? DICTS.en)[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export const fmtMoney = (amount: number, currency = 'VND') =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
