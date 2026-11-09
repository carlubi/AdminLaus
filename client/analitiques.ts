import type { AnaliticaPrescriptor, Prescriptor } from './tipus.js';
import { api } from './comuns.js';

type Tauler = { id: string; nom: string; columnesLead: string[]; columnaStatusExp: string };
type Item = { id: string; name: string; created_at: string; group: { title: string } | null;
  column_values: { id: string; text: string }[] };
type Registre = AnaliticaPrescriptor['registres'][number] & { taulerId: string };

const normalitza = (text: string): string => String(text || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function clausPrescriptor(p: Pick<Prescriptor, 'empresa' | 'contacte'>): string[] {
  const descarta = new Set(['sl', 'sa', 'del', 'les', 'assessors', 'consultoria', 'grupo', 'group', 'empresa']);
  const fonts = [p.empresa, p.contacte].map(normalitza).filter(Boolean);
  const claus = new Set(fonts.filter(x => x.length >= 5));
  for (const font of fonts) for (const paraula of font.split(' ')) {
    if (paraula.length >= 5 && !descarta.has(paraula)) claus.add(paraula);
  }
  if (normalitza(p.empresa).includes('innovalaus')) claus.add('ilaus');
  return [...claus];
}

function serieDe(items: Registre[]): AnaliticaPrescriptor['serie'] {
  const mesos = new Map<string, { mes: string; leads: number; sollicituds: number }>();
  for (const r of items) {
    const mes = r.data ? r.data.slice(0, 7) : 'Sense data';
    const valor = mesos.get(mes) || { mes, leads: 0, sollicituds: 0 };
    valor.leads++;
    if (r.estat === 'sollicitud') valor.sollicituds++;
    mesos.set(mes, valor);
  }
  return [...mesos.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/** Consulta els taulers per pàgines; cap petició espera l'escaneig complet del workspace. */
export async function carregaAnalitiques(
  p: Pick<Prescriptor, 'id' | 'empresa' | 'contacte'>,
  progres?: (fets: number, total: number) => void,
): Promise<AnaliticaPrescriptor> {
  const { taulers } = await api<{ taulers: Tauler[] }>('/api/analitiques/taulers');
  const claus = clausPrescriptor(p);
  const registres: Registre[] = [];
  let fets = 0;
  progres?.(fets, taulers.length);
  const pendents = [...taulers];
  const worker = async (): Promise<void> => {
    for (let tauler = pendents.shift(); tauler; tauler = pendents.shift()) {
      let cursor = '';
      do {
        const pagina: { cursor: string; items: Item[] } = await api(
          `/api/analitiques/taulers/${tauler.id}/pagina${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        for (const item of pagina.items) {
          const grup = item.group?.title || '';
          const nomGrup = normalitza(grup);
          const estat = /sol licitud|sollicitud/.test(nomGrup) ? 'sollicitud'
            : /lead/.test(nomGrup) ? 'lead' : null;
          if (!estat) continue;
          const lead = ` ${normalitza(item.column_values.filter(c => tauler.columnesLead.includes(c.id)).map(c => c.text).join(' '))} `;
          if (!claus.some(clau => lead.includes(` ${clau} `))) continue;
          registres.push({ id: item.id, empresa: item.name, data: (item.created_at || '').slice(0, 10),
            subvencio: tauler.nom, taulerId: tauler.id, grup, estat,
            statusExp: item.column_values.find(c => c.id === tauler.columnaStatusExp)?.text || '' });
        }
        cursor = pagina.cursor;
      } while (cursor);
      progres?.(++fets, taulers.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, taulers.length) }, () => worker()));

  const leads = registres.length;
  const sollicituds = registres.filter(r => r.estat === 'sollicitud').length;
  const perSubvencio = [...new Set(registres.map(r => r.subvencio))].sort().map(subvencio => {
    const items = registres.filter(r => r.subvencio === subvencio).sort((a, b) => b.data.localeCompare(a.data));
    return { subvencio, leads: items.length,
      sollicituds: items.filter(r => r.estat === 'sollicitud').length,
      items: items.map(r => ({ id: r.id, empresa: r.empresa, data: r.data, estat: r.estat, statusExp: r.statusExp || '' })) };
  });
  const seriePerSubvencio = Object.fromEntries(perSubvencio.map(x => [x.subvencio,
    serieDe(registres.filter(r => r.subvencio === x.subvencio))]));
  return { prescriptor: p, resum: { leads, sollicituds,
    conversio: leads ? Math.round(sollicituds / leads * 1000) / 10 : 0 },
    perSubvencio, serie: serieDe(registres), seriePerSubvencio,
    registres: registres.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 100),
    cobertura: { taulers: taulers.length, coincidencies: registres.length },
    cache: { actualitzada: new Date().toISOString(), actualitzant: false, desfasada: false } };
}
