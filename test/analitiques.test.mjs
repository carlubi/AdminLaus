import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carregaAnalitiques } from '../dist/analitiques.js';

test('el detall suma coincidències de diverses pàgines sense una petició llarga', async () => {
  const peticions = [];
  const anterior = globalThis.fetch;
  globalThis.fetch = async url => {
    peticions.push(String(url));
    const dades = String(url).endsWith('/taulers')
      ? { taulers: [{ id: '12', nom: 'Ajuts', columnesLead: ['lead'], columnaStatusExp: 'status' }] }
      : String(url).includes('cursor=segona')
        ? { cursor: '', items: [{ id: '2', name: 'Client B', created_at: '2026-11-02',
          group: { title: 'Sol·licitud' }, column_values: [{ id: 'lead', text: '@Acme Consultors' }, { id: 'status', text: 'En curs' }] }] }
        : { cursor: 'segona', items: [{ id: '1', name: 'Client A', created_at: '2026-11-01',
          group: { title: 'Leads' }, column_values: [{ id: 'lead', text: '@Acme Consultors' }] }] };
    return { ok: true, json: async () => dades };
  };
  try {
    const a = await carregaAnalitiques({ id: '7', empresa: 'Acme Consultors', contacte: '' });
    assert.equal(a.resum.leads, 2);
    assert.equal(a.resum.sollicituds, 1);
    assert.equal(a.resum.conversio, 50);
    assert.equal(a.perSubvencio[0].leads, 2);
    assert.equal(a.perSubvencio[0].sollicituds, 1);
    assert.equal(a.serie[0].leads, 2);
    assert.equal(a.serie[0].sollicituds, 1);
    assert.equal(a.perSubvencio[0].items.length, 2);
    assert.equal(a.perSubvencio[0].items[0].statusExp, 'En curs');
    assert.equal(peticions.length, 3);
  } finally {
    globalThis.fetch = anterior;
  }
});
