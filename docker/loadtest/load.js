// Refearn yuk testi (Faz D7) — k6 ile kilit okuma uclari.
//   Kurulum:  https://k6.io/docs/get-started/installation/
//   Calistir: BASE=http://localhost:3101/v1 EMAIL=owner@oppein.test PASS='Refearn-Demo-2026!' \
//             k6 run docker/loadtest/load.js
//   Esikler (threshold) ASILIRSA k6 non-zero doner → CI'da kapi olarak kullanilabilir.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3101/v1';
const EMAIL = __ENV.EMAIL || 'owner@oppein.test';
const PASS = __ENV.PASS || 'Refearn-Demo-2026!';

const errors = new Rate('app_errors');

export const options = {
  scenarios: {
    // 1 dk ramp 0→50 VU, 2 dk sabit 50, 30s ramp-down — orta yuk profili
    steady: { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: '1m', target: 50 },
      { duration: '2m', target: 50 },
      { duration: '30s', target: 0 },
    ] },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],     // < %1 HTTP hata
    http_req_duration: ['p(95)<500'],   // p95 < 500ms
    app_errors: ['rate<0.01'],
  },
};

// Her VU bir kez login olur (token'i tutar) — gercek kullanim deseni.
export function setup() {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: EMAIL, password: PASS }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return { token: res.json('accessToken') };
}

export default function (data) {
  const params = { headers: { Authorization: `Bearer ${data.token}` } };
  // okuma-agirlikli karisik trafik (dashboard + listeler)
  const reqs = [
    ['GET', `${BASE}/admin/dashboard`],
    ['GET', `${BASE}/admin/sales?page=1&pageSize=20`],
    ['GET', `${BASE}/admin/members?page=1&pageSize=20`],
    ['GET', `${BASE}/admin/cohorts`],
  ];
  for (const [method, url] of reqs) {
    const r = http.request(method, url, null, params);
    const ok = check(r, { [`${url} 200`]: (x) => x.status === 200 });
    errors.add(!ok);
  }
  sleep(1);
}
