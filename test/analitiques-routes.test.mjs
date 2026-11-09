import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';

process.env.MONDAY_API_KEY = 'prova';
const { default: vercelRequest } = await import('../api/index.mjs');

async function request(url) {
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.writeHead = status => { response.statusCode = status; };
  const finished = new Promise(resolve => response.once('finish', resolve));
  await vercelRequest({ url, method: 'GET', headers: { host: 'localhost' } }, response);
  await finished;
  return { status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) };
}

test('les rutes paginades arriben a la funció de Vercel', async () => {
  const anterior = globalThis.fetch;
  globalThis.fetch = async (_, opcions) => {
    const { query } = JSON.parse(opcions.body);
    const data = query.includes('workspace_ids')
      ? { boards: [{ id: '12', name: 'Ajuts', groups: [{ title: 'Leads' }],
        columns: [{ id: 'lead', title: 'LEAD' }] }] }
      : { boards: [{ items_page: { cursor: null, items: [] } }] };
    return { ok: true, json: async () => ({ data }) };
  };
  try {
    const taulers = await request('/api/index.mjs?__apiPath=analitiques/taulers');
    assert.equal(taulers.status, 200);
    assert.equal(taulers.body.taulers[0].id, '12');

    const pagina = await request('/api/index?__apiPath=analitiques/taulers/12/pagina');
    assert.equal(pagina.status, 200);
    assert.deepEqual(pagina.body, { cursor: '', items: [] });
  } finally {
    globalThis.fetch = anterior;
  }
});
