// Kiểm thử tự động các luồng chính. Chạy: node scripts/smoke.mjs   (Node 20+)
// Biến môi trường: BASE (mặc định http://localhost:8080/api), BRUTE=1 để thử khóa mã ngắn (sẽ khóa IP 5 phút!)
const BASE = process.env.BASE ?? 'http://localhost:8080/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const code = (r) => r.data?.error?.code;

async function pollExchange(authCode, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const r = await call('POST', '/auth/exchange', { body: { authCode } });
    if (r.status !== 202) return r;
    await sleep(1000);
  }
  return { status: 202, data: null };
}

async function pollShortCode(orderId, staffToken, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await call('GET', `/auth/staff/orders/${orderId}/short-code`, { token: staffToken });
    if (r.status !== 202) return r;
    await sleep(1000);
  }
  return { status: 202, data: null };
}

const jti = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).jti;

console.log(`Smoke test -> ${BASE}\n`);

console.log('[0] Sức khỏe & đăng nhập');
const health = await fetch(BASE.replace(/\/api$/, '') + '/health').then((r) => r.status).catch(() => 0);
check('gateway /health = 200', health === 200, `(status ${health}; đã chạy docker compose up chưa?)`);
const sBad = await call('POST', '/auth/staff/login', { body: { username: 'staff1', password: 'sai-mat-khau' } });
check('đăng nhập sai mật khẩu -> 401', sBad.status === 401 && code(sBad) === 'INVALID_CREDENTIALS');
const staff = await call('POST', '/auth/staff/login', { body: { username: 'staff1', password: 'Staff@12345' } });
check('đăng nhập staff1 -> 200 có accessToken', staff.status === 200 && !!staff.data?.accessToken);
const admin = await call('POST', '/auth/staff/login', { body: { username: 'admin', password: process.env.ADMIN_PASSWORD ?? 'Admin@12345' } });
check('đăng nhập admin -> 200', admin.status === 200);
const S = staff.data?.accessToken, A = admin.data?.accessToken;

const prods = await call('GET', '/payments/products');
check('danh sách vé có DAY_PASS', prods.status === 200 && prods.data?.some((p) => p.code === 'DAY_PASS'));

console.log('\n[1] Luồng ONLINE (mock Payoo)');
const on = await call('POST', '/payments/online', { body: { productCode: 'DAY_PASS', lang: 'vi' } });
check('tạo đơn online -> 201 có paymentUrl + authCode', on.status === 201 && !!on.data?.paymentUrl && !!on.data?.authCode, JSON.stringify(on.data));
const pre = await call('POST', '/auth/exchange', { body: { authCode: on.data?.authCode ?? 'x'.repeat(20) } });
check('chưa thanh toán: exchange -> 202 PAYMENT_PENDING', pre.status === 202);
const pay = await fetch(on.data.paymentUrl, { redirect: 'manual' });
check('mở paymentUrl (mock) -> redirect 3xx', pay.status >= 300 && pay.status < 400, `(status ${pay.status})`);
const tok = await pollExchange(on.data.authCode);
check('sau khi thanh toán: exchange -> 200 có accessToken', tok.status === 200 && !!tok.data?.accessToken, `(status ${tok.status})`);
const reuse = await call('POST', '/auth/exchange', { body: { authCode: on.data.authCode } });
check('dùng lại authCode -> 409 CODE_ALREADY_USED', reuse.status === 409 && code(reuse) === 'CODE_ALREADY_USED');
const T = tok.data?.accessToken;

console.log('\n[2] Webhook: chữ ký & chống trùng');
const badWh = await call('POST', '/payments/webhook/payoo', {
  body: JSON.stringify({ eventId: 'EVIL-1', orderCode: on.data.orderCode, status: 'SUCCESS', amount: 20000 }),
  headers: { 'x-payoo-signature': 'deadbeef' },
});
check('webhook sai chữ ký -> 400 INVALID_SIGNATURE', badWh.status === 400 && code(badWh) === 'INVALID_SIGNATURE');
await fetch(on.data.paymentUrl, { redirect: 'manual' }); // gửi lại cùng eventId
const st = await call('GET', `/payments/orders/${on.data.orderCode}`);
check('webhook trùng: đơn vẫn PAID (không xử lý lại)', st.status === 200 && st.data?.status === 'PAID');

console.log('\n[3] Phân quyền & token');
const noTok = await call('GET', '/poi/dataset/latest');
check('không có token -> 401', noTok.status === 401);
const prev = await call('GET', '/poi/dataset/latest');
check('chưa có vé: không tải được dữ liệu POI -> 401', prev.status === 401);
const withTok = await call('GET', '/poi/dataset/latest', { token: T });
check('token khách hợp lệ -> qua gateway (200 hoặc 404 chưa publish)', withTok.status === 200 || (withTok.status === 404 && code(withTok) === 'NO_PUBLISHED_DATASET'), `(status ${withTok.status})`);
const tourAdmin = await call('GET', '/payments/admin/orders', { token: T });
check('token khách gọi API nhân viên -> 403', tourAdmin.status === 403);
const staffAdminOnly = await call('GET', '/payments/admin/products', { token: S });
check('staff gọi API chỉ ADMIN -> 403', staffAdminOnly.status === 403);
const adminProducts = await call('GET', '/payments/admin/products', { token: A });
check('admin xem sản phẩm vé -> 200', adminProducts.status === 200);

console.log('\n[4] Luồng TIỀN MẶT');
const cash = await call('POST', '/payments/cash', { body: { productCode: 'DAY_PASS' } });
check('tạo đơn tiền mặt -> 201 có orderId', cash.status === 201 && !!cash.data?.orderId, JSON.stringify(cash.data));
const find = await call('GET', `/payments/admin/orders/by-code/${cash.data.orderCode}`, { token: S });
check('nhân viên tìm đơn theo mã -> 200 PENDING', find.status === 200 && find.data?.status === 'PENDING');
const wrongAmt = await call('POST', `/payments/admin/orders/${cash.data.orderId}/confirm-cash`, { token: S, body: { amountReceived: 1000 } });
check('thu sai số tiền -> 400 AMOUNT_MISMATCH', wrongAmt.status === 400 && code(wrongAmt) === 'AMOUNT_MISMATCH');
const conf = await call('POST', `/payments/admin/orders/${cash.data.orderId}/confirm-cash`, { token: S, body: { amountReceived: cash.data.amount } });
check('xác nhận thu đúng tiền -> 200 PAID', conf.status === 200 && conf.data?.status === 'PAID');
const conf2 = await call('POST', `/payments/admin/orders/${cash.data.orderId}/confirm-cash`, { token: S, body: { amountReceived: cash.data.amount } });
check('xác nhận lần 2 -> 409 ORDER_ALREADY_PAID', conf2.status === 409 && code(conf2) === 'ORDER_ALREADY_PAID');
const sc = await pollShortCode(cash.data.orderId, S);
check('lấy mã ngắn -> 200 (chờ event qua RabbitMQ)', sc.status === 200 && !!sc.data?.shortCode, `(status ${sc.status})`);
const ex = await call('POST', '/auth/exchange-short', { body: { shortCode: sc.data?.shortCode ?? 'AAAAAA' } });
check('đổi mã ngắn -> 200 accessToken', ex.status === 200 && !!ex.data?.accessToken);
const ex2 = await call('POST', '/auth/exchange-short', { body: { shortCode: sc.data?.shortCode ?? 'AAAAAA' } });
check('dùng lại mã ngắn -> 401 INVALID_CODE', ex2.status === 401 && code(ex2) === 'INVALID_CODE');

console.log('\n[5] Thu hồi phiên (denylist)');
const sid = T ? jti(T) : null;
const rev = await call('POST', `/auth/admin/sessions/${sid}/revoke`, { token: A, body: { reason: 'SMOKE_TEST' } });
check('admin thu hồi phiên -> 204', rev.status === 204, `(status ${rev.status})`);
const after = await call('GET', '/poi/dataset/latest', { token: T });
check('token đã thu hồi -> 401 TOKEN_REVOKED', after.status === 401 && code(after) === 'TOKEN_REVOKED');

console.log('\n[6] Chủ địa điểm: đăng ký -> duyệt -> gửi POI -> duyệt POI');
const ou = 'smoke_owner_' + Date.now().toString(36);
const OPASS = 'Owner@12345';
const reg = await call('POST', '/auth/owner/register', { body: { username: ou, password: OPASS, fullName: 'Chu Quan Thu', phone: '0901234567', businessName: 'Quan thu nghiem' } });
check('chủ quán đăng ký -> 201 PENDING', reg.status === 201 && reg.data?.status === 'PENDING', JSON.stringify(reg.data));
const oEarly = await call('POST', '/auth/staff/login', { body: { username: ou, password: OPASS } });
check('chưa duyệt: đăng nhập -> 401', oEarly.status === 401);
const regs = await call('GET', '/auth/admin/owner-registrations?status=PENDING', { token: A });
const myReg = regs.data?.find?.((x) => x.username === ou);
const appr = await call('POST', `/auth/admin/owner-registrations/${myReg?.id}/approve`, { token: A, body: {} });
check('admin duyệt hồ sơ -> 204', appr.status === 204, `(status ${appr.status})`);
const oLogin = await call('POST', '/auth/staff/login', { body: { username: ou, password: OPASS } });
check('đã duyệt: đăng nhập -> 200 role OWNER', oLogin.status === 200 && oLogin.data?.role === 'OWNER');
const O = oLogin.data?.accessToken;
const poiBody = { name: 'Quan thu nghiem', shortDescription: 'Quan nuoc gan chua', description: 'Day la noi dung gioi thieu thu nghiem cho quan nuoc gan chua Linh Ung.', latitude: 16.1001, longitude: 108.2775, triggerRadiusM: 20 };
const op = await call('POST', '/poi/owner/pois', { token: O, body: poiBody });
check('chủ quán tạo POI -> 201 PENDING', op.status === 201 && op.data?.reviewStatus === 'PENDING', JSON.stringify(op.data));
const opList = await call('GET', '/poi/owner/pois', { token: O });
check('chủ quán chỉ thấy POI của mình', opList.status === 200 && opList.data?.items?.length === 1);
const opStaff = await call('GET', '/poi/owner/pois', { token: S });
check('staff gọi API chủ quán -> 403', opStaff.status === 403);
const opTourist = await call('GET', '/poi/owner/pois', { token: ex.data?.accessToken });
check('khách gọi API chủ quán -> 403', opTourist.status === 403);
const ownerAdmin = await call('GET', '/poi/admin/pois', { token: O });
check('chủ quán gọi API quản trị POI -> 403', ownerAdmin.status === 403);
const pend = await call('GET', '/poi/admin/owner-pois?review=PENDING', { token: A });
check('admin thấy POI chờ duyệt kèm tên chủ quán', pend.status === 200 && pend.data?.some((p) => p.id === op.data?.id && p.owner_name === ou));
const rejNoNote = await call('POST', `/poi/admin/owner-pois/${op.data?.id}/reject`, { token: A, body: {} });
check('từ chối không ghi lý do -> 400', rejNoNote.status === 400);
const okPoi = await call('POST', `/poi/admin/owner-pois/${op.data?.id}/approve`, { token: A, body: { note: 'OK' } });
check('admin duyệt POI -> 200, xếp việc dịch', okPoi.status === 200 && okPoi.data?.translateQueued >= 1, JSON.stringify(okPoi.data));
const okPoi2 = await call('POST', `/poi/admin/owner-pois/${op.data?.id}/approve`, { token: A, body: {} });
check('duyệt lần 2 -> 409 ALREADY_REVIEWED', okPoi2.status === 409 && code(okPoi2) === 'ALREADY_REVIEWED');
const edit = await call('PUT', `/poi/owner/pois/${op.data?.id}`, { token: O, body: { ...poiBody, name: 'Quan thu nghiem (sua)' } });
check('chủ quán sửa POI -> quay về PENDING', edit.status === 200 && edit.data?.reviewStatus === 'PENDING');
const del = await call('DELETE', `/poi/owner/pois/${op.data?.id}`, { token: O });
check('chủ quán xóa POI -> 204', del.status === 204);

if (process.env.BRUTE === '1') {
  console.log('\n[7] Dò mã ngắn (sẽ khóa IP 5 phút)');
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/auth/exchange-short', { body: { shortCode: 'ZZZZZ' + i } });
  check('sau 5 lần sai -> 429 TOO_MANY_ATTEMPTS', last.status === 429 && code(last) === 'TOO_MANY_ATTEMPTS', `(status ${last.status})`);
  console.log('  Mở khóa nhanh: docker compose exec redis redis-cli flushall');
}

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
