import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { handleLocalRequest } from '../lib/server.mjs';
import vercelRequest from '../api/index.mjs';

async function request(handler, url, { method = 'GET', body } = {}) {
  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.writeHead = (status, headers) => {
    response.statusCode = status;
    response.headers = headers;
  };
  const finished = new Promise(resolve => response.once('finish', resolve));
  await handler({ url, method, body, headers: { host: 'localhost' } }, response);
  await finished;
  return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() };
}

test('el servidor local entrega la página y el JavaScript compilado', async () => {
  const page = await request(handleLocalRequest, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Control de prescriptors/);
  assert.match(page.body, /src="\/dist\/app\.js"/);

  const script = await request(handleLocalRequest, '/dist/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['Content-Type'], /javascript/);
  assert.match(script.body, /\.\/calendari\.js/);

  for (const asset of ['/logo.png', '/favicon.png']) {
    const result = await request(handleLocalRequest, asset);
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Type'], 'image/png');
  }
});

test('la función Vercel solo atiende la API y recupera la ruta del rewrite', async () => {
  const page = await request(vercelRequest, '/');
  assert.equal(page.status, 404);
  assert.match(page.headers['Content-Type'], /json/);

  const invalid = await request(vercelRequest, '/api/index.mjs?__apiPath=elements', {
    method: 'POST', body: {},
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body, /empresa/);

  const nested = await request(vercelRequest, '/api/index.mjs?__apiPath=unknown/nested');
  assert.equal(nested.status, 404);
  assert.match(nested.body, /Ruta desconeguda/);
});
