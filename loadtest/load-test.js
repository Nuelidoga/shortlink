// k6 load test. Run during the demo to show autoscaling:
//   k6 run -e BASE_URL=http://<gateway-ip> loadtest/load-test.js
// Then watch the autoscaler add pods:
//   kubectl get hpa,pods -n shortlink --watch
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // warm up
    { duration: '2m', target: 150 },  // push hard, triggers scale-out
    { duration: '30s', target: 0 },   // cool down
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],    // under 2% errors
    http_req_duration: ['p(95)<1000'], // 95% of requests under 1s
  },
};

const BASE_URL = __ENV.BASE_URL;

export function setup() {
  if (!BASE_URL) throw new Error('Set BASE_URL, e.g. -e BASE_URL=http://<gateway-ip>');
  const res = http.post(
    `${BASE_URL}/api/links`,
    JSON.stringify({ url: 'https://learn.microsoft.com/azure/container-apps/' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'link created': (r) => r.status === 201 });
  return { code: res.json('code') };
}

export default function (data) {
  const list = http.get(`${BASE_URL}/api/links`);
  check(list, { 'list is 200': (r) => r.status === 200 });

  const redirect = http.get(`${BASE_URL}/${data.code}`, { redirects: 0 });
  check(redirect, { 'redirect is 302': (r) => r.status === 302 });

  sleep(0.5);
}
