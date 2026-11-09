// Lectura (solo GET) de la API de Bitbucket Cloud con el token del entorno.
// El token va por la configuración de curl en stdin (-K -): nunca aparece en argv ni en la URL.
// Validado en la Fase 0.B: para la API funciona "Authorization: Bearer <token>" (access token);
// con un API token de Atlassian se usa Basic BITBUCKET_USER:token.
import { spawnSync } from 'node:child_process';

const UA = 'TorreControlOperaciones/0.1 (descubrimiento)';

function credencial() {
  const tok = process.env.BITBUCKET_TOKEN;
  if (!tok) return null;
  return process.env.BITBUCKET_USER
    ? 'Basic ' + Buffer.from(`${process.env.BITBUCKET_USER}:${tok}`).toString('base64')
    : `Bearer ${tok}`;
}

export function bbGet(ruta) {
  const cred = credencial();
  if (!cred) return { http: 0, cuerpo: null, error: 'Falta BITBUCKET_TOKEN' };
  const url = ruta.startsWith('http') ? ruta : `https://api.bitbucket.org/2.0/${ruta.replace(/^\//, '')}`;
  const cfg = [`url = "${url.replace(/"/g, '\\"')}"`, `header = "Authorization: ${cred}"`, `user-agent = "${UA}"`].join('\n') + '\n';
  const r = spawnSync('curl', ['-sS', '-K', '-', '-w', '\n__HTTP__%{http_code}'], { input: cfg, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const out = r.stdout || '';
  const i = out.lastIndexOf('__HTTP__');
  const http = i < 0 ? 0 : Number(out.slice(i + 8).trim());
  const cuerpo = i < 0 ? out : out.slice(0, i);
  return { http, cuerpo, error: r.status !== 0 ? (r.stderr || '').trim() : null };
}

export function bbJson(ruta) {
  const r = bbGet(ruta);
  if (r.http !== 200) return { ok: false, http: r.http, error: r.error };
  try { return { ok: true, data: JSON.parse(r.cuerpo) }; } catch { return { ok: false, http: r.http, error: 'respuesta no JSON' }; }
}

// Lista los repos de un workspace (paginado). Devuelve { repos: [{ slug, branch, updated }], http, error }.
export function listarRepos(workspace, maximo = 1000) {
  const repos = [];
  let ruta = `repositories/${encodeURIComponent(workspace)}?pagelen=100&fields=next,values.slug,values.mainbranch.name,values.updated_on`;
  while (ruta && repos.length < maximo) {
    const r = bbJson(ruta);
    if (!r.ok) return { repos, http: r.http, error: r.error };
    for (const v of r.data.values || []) repos.push({ slug: v.slug, branch: (v.mainbranch && v.mainbranch.name) || 'main', updated: v.updated_on || null });
    ruta = r.data.next || null;
  }
  return { repos, http: 200 };
}

// Nombre del paquete UiPath (project.json "name") de un repo: en la raíz o en una carpeta de primer nivel.
export function paqueteDeRepo(workspace, slug, branch) {
  const base = `repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/src/${encodeURIComponent(branch)}`;
  const leer = (ruta) => {
    const r = bbGet(`${base}/${ruta}`);
    if (r.http !== 200) return null;
    try { return JSON.parse(r.cuerpo).name || null; } catch { return null; }
  };
  const raiz = leer('project.json');
  if (raiz) return { paquete: raiz, ruta: 'project.json' };
  const lista = bbJson(`${base}/?pagelen=100&fields=values.path,values.type`);
  if (!lista.ok) return { paquete: null, ruta: null };
  for (const v of (lista.data.values || []).filter((x) => x.type === 'commit_directory').slice(0, 10)) {
    const p = leer(`${v.path}/project.json`);
    if (p) return { paquete: p, ruta: `${v.path}/project.json` };
  }
  return { paquete: null, ruta: null };
}
