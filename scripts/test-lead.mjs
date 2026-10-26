// Sends one test lead to the api/lead.js handler and prints only the HTTP status
// and the response body. It never reads .env files and never prints environment
// variables; supply them yourself, e.g.: node --env-file=.env.local scripts/test-lead.mjs
import api from '../api/lead.js';

const request = new Request('http://localhost/api/lead', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-forwarded-for': '127.0.0.1',
  },
  body: JSON.stringify({
    name: 'Тест',
    contact: '+7 701 000 00 00',
    message: 'Тестовая заявка',
    pointType: 'Аптеки',
    points: '2–5',
    samples: true,
    consent: true,
  }),
});

const response = await api.fetch(request);
console.log(response.status);
console.log(await response.text());
process.exitCode = response.ok ? 0 : 1;
