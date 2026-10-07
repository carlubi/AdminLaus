// Servidor sense dependències: serveix la web i fa de pont amb l'API de Monday.
// La clau d'API es queda sempre al servidor, mai arriba al navegador.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  llegeixEsquema, llistaElements, creaElement, actualitzaElement, esborraElement, API_KEY, BOARD_ID,
  llistaUpdates, creaUpdate, esborraUpdate, analitiquesPrescriptor, actualitzaCacheSubvencions,
} from './monday.mjs';
import {
  esquemaCalendari, estatsSubtasques, llistaSubvencions, creaSubvencio, actualitzaSubvencio,
  esborraSubvencio, creaAccio, actualitzaAccio, esborraAccio, TAULER_CAL,
} from './calendari.mjs';

const ARREL = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

const TIPUS_MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.map': 'application/json; charset=utf-8',
};

// Els esquemes dels taulers canvien molt poc: els guardem en memòria uns minuts.
let cache = { esquema: null, quan: 0 };
async function esquema() {
  if (cache.esquema && Date.now() - cache.quan < 5 * 60_000) return cache.esquema;
  cache = { esquema: await llegeixEsquema(), quan: Date.now() };
  return cache.esquema;
}

let cacheCal = { esquema: null, quan: 0 };
async function esquemaCal() {
  if (cacheCal.esquema && Date.now() - cacheCal.quan < 5 * 60_000) return cacheCal.esquema;
  const e = await esquemaCalendari();
  e.estatsSub = await estatsSubtasques(e.taulerSub);
  cacheCal = { esquema: e, quan: Date.now() };
  return e;
}

const json = (res, codi, cos) => {
  res.writeHead(codi, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cos));
};

function cos(req) {
  return new Promise((ok, ko) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) { ko(new Error('Petició massa gran')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ko(new Error('JSON no vàlid')); } });
    req.on('error', ko);
  });
}

function fitxerEstatic(res, url) {
  const nom = url === '/' ? '/index.html' : url;
  const fitxer = path.join(ARREL, path.normalize(nom).replace(/^(\.\.[/\\])+/, ''));
  // Mai servim res de fora de la carpeta del projecte, ni fitxers ocults, ni node_modules.
  const amagat = nom.split('/').some(t => t.startsWith('.') || t === 'node_modules');
  if (!fitxer.startsWith(ARREL) || amagat || !fs.existsSync(fitxer) || !fs.statSync(fitxer).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No s\'ha trobat la pàgina');
  }
  res.writeHead(200, { 'Content-Type': TIPUS_MIME[path.extname(fitxer)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fitxer).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ruta = url.pathname;

  if (!ruta.startsWith('/api/')) return fitxerEstatic(res, ruta);

  try {
    if (ruta === '/api/esquema' && req.method === 'GET') {
      const e = await esquema();
      return json(res, 200, {
        boardId: e.boardId, nomTauler: e.nomTauler, responsables: e.responsables,
        estats: e.estats, comunitats: e.comunitats, falten: e.falten,
      });
    }

    if (ruta === '/api/elements' && req.method === 'GET') {
      return json(res, 200, { elements: await llistaElements(await esquema()) });
    }

    const mAnalitiques = ruta.match(/^\/api\/prescriptors\/(\d+)\/analitiques$/);
    if (mAnalitiques && req.method === 'GET') {
      // La fitxa ja és a la taula del navegador. Reutilitzem nom i contacte per no
      // tornar a llegir tot el tauler de prescriptors abans de cada expedient.
      const empresa = url.searchParams.get('empresa');
      const contacte = url.searchParams.get('contacte');
      const p = empresa !== null
        ? { id: mAnalitiques[1], empresa, contacte: contacte || '' }
        : (await llistaElements(await esquema())).find(x => String(x.id) === mAnalitiques[1]);
      if (!p) return json(res, 404, { error: 'No s\'ha trobat el prescriptor' });
      return json(res, 200, await analitiquesPrescriptor(p));
    }

    if (ruta === '/api/analitiques/actualitza' && req.method === 'POST') {
      await actualitzaCacheSubvencions();
      return json(res, 200, { ok: true });
    }

    if (ruta === '/api/elements' && req.method === 'POST') {
      const dades = await cos(req);
      if (!String(dades.empresa || '').trim()) return json(res, 400, { error: 'El nom de l\'empresa és obligatori' });
      const id = await creaElement(await esquema(), dades);
      return json(res, 201, { id });
    }

    /* ----- updates: els comentaris de Monday, compartits per les dues pestanyes ----- */

    const mUpd = ruta.match(/^\/api\/updates\/(\d+)$/);
    if (mUpd && req.method === 'GET') {
      return json(res, 200, { updates: await llistaUpdates(mUpd[1]) });
    }
    if (mUpd && req.method === 'POST') {
      const { text, pareId } = await cos(req);
      if (!String(text || '').trim()) return json(res, 400, { error: 'El comentari no pot ser buit' });
      return json(res, 201, { id: await creaUpdate(mUpd[1], text, pareId || null) });
    }
    if (mUpd && req.method === 'DELETE') {
      await esborraUpdate(mUpd[1]);
      return json(res, 200, { ok: true });
    }

    /* ----- calendari trimestral de subvencions ----- */

    if (ruta === '/api/calendari/esquema' && req.method === 'GET') {
      return json(res, 200, await esquemaCal());
    }

    if (ruta === '/api/calendari/subvencions' && req.method === 'GET') {
      return json(res, 200, { subvencions: await llistaSubvencions() });
    }

    if (ruta === '/api/calendari/subvencions' && req.method === 'POST') {
      const dades = await cos(req);
      if (!String(dades.titol || '').trim()) return json(res, 400, { error: 'El títol és obligatori' });
      if (!String(dades.grupId || '').trim()) return json(res, 400, { error: 'Falta el trimestre' });
      const id = await creaSubvencio(dades);
      void actualitzaCacheSubvencions().catch(e => console.warn(`No s'ha pogut actualitzar la memòria cau: ${e.message}`));
      return json(res, 201, { id });
    }

    const mSub = ruta.match(/^\/api\/calendari\/subvencions\/(\d+)$/);
    if (mSub && req.method === 'PATCH') {
      await actualitzaSubvencio(mSub[1], await cos(req));
      void actualitzaCacheSubvencions().catch(e => console.warn(`No s'ha pogut actualitzar la memòria cau: ${e.message}`));
      return json(res, 200, { ok: true });
    }
    if (mSub && req.method === 'DELETE') {
      await esborraSubvencio(mSub[1]);
      void actualitzaCacheSubvencions().catch(e => console.warn(`No s'ha pogut actualitzar la memòria cau: ${e.message}`));
      return json(res, 200, { ok: true });
    }

    const mAcc = ruta.match(/^\/api\/calendari\/subvencions\/(\d+)\/accions$/);
    if (mAcc && req.method === 'POST') {
      const dades = await cos(req);
      if (!String(dades.titol || '').trim()) return json(res, 400, { error: 'El títol de l\'acció és obligatori' });
      return json(res, 201, { id: await creaAccio(mAcc[1], dades) });
    }

    const mAcc2 = ruta.match(/^\/api\/calendari\/accions\/(\d+)$/);
    if (mAcc2 && req.method === 'PATCH') {
      const e = await esquemaCal();
      if (!e.taulerSub) return json(res, 409, { error: 'El tauler no té subtasques configurades' });
      await actualitzaAccio(e.taulerSub, mAcc2[1], await cos(req));
      return json(res, 200, { ok: true });
    }
    if (mAcc2 && req.method === 'DELETE') {
      await esborraAccio(mAcc2[1]);
      return json(res, 200, { ok: true });
    }

    const m = ruta.match(/^\/api\/elements\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      await actualitzaElement(await esquema(), m[1], await cos(req));
      return json(res, 200, { ok: true });
    }
    if (m && req.method === 'DELETE') {
      await esborraElement(m[1]);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Ruta desconeguda' });
  } catch (e) {
    console.error(`[${req.method} ${ruta}]`, e.message);
    return json(res, 502, { error: e.message });
  }
});

servidor.listen(PORT, async () => {
  console.log(`\n  Control de prescriptors · http://localhost:${PORT}\n`);
  if (!API_KEY) return console.error('  ⚠ Falta monday_apiKey al fitxer .env: la web no podrà sincronitzar.\n');
  try {
    const e = await esquema();
    console.log(`  Tauler de Monday: ${e.nomTauler} (${BOARD_ID})`);
    if (e.falten.length) console.log(`  ⚠ Falten columnes: ${e.falten.join(', ')} → executa: node setup-monday.mjs`);
    else console.log('  ✓ Totes les columnes lligades correctament.');
    const c = await esquemaCal();
    console.log(`  Calendari de subvencions: ${c.nomTauler} (${TAULER_CAL})`);
    if (c.falten.length) console.log(`  ⚠ Falten columnes al calendari: ${c.falten.join(', ')}`);
    else console.log(`  ✓ Calendari lligat ${c.taulerSub ? '(amb subtasques)' : '(sense subtasques)'}.`);
  } catch (e) { console.error(`  ⚠ No s'ha pogut llegir el tauler: ${e.message}`); }
  // No bloquegem l'arrencada: una còpia persistent ja es pot servir mentre es refresca Monday.
  void actualitzaCacheSubvencions().catch(e => console.warn(`  ⚠ No s'ha pogut actualitzar les analítiques: ${e.message}`));
  console.log('');
});
