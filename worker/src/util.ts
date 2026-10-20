// Funções comuns do servidor.

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-master-key',
  'access-control-max-age': '86400',
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export const DAY = 86_400_000;
