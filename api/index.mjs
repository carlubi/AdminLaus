// Adaptador de la API HTTP local al runtime Node.js de Vercel.
import handleRequest from '../lib/server.mjs';

export default function vercelRequest(req, res) {
  // El rewrite conserva la ruta como parámetro, incluso si el runtime expone
  // /api/index.mjs en req.url en lugar de la URL original.
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.searchParams.get('__apiPath');
  if (path && url.pathname === '/api/index.mjs') {
    url.pathname = `/api/${path.replace(/^\/+/, '')}`;
    url.searchParams.delete('__apiPath');
    req.url = `${url.pathname}${url.search}`;
  }
  return handleRequest(req, res);
}
