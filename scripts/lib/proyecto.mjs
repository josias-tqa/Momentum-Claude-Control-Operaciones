// Modelo de proyecto: un PROYECTO agrupa uno o más PROCESOS (p. ej. Dispatcher, Performer, Reporter).
// Normalmente comparten la carpeta de Orchestrator del proyecto, pero cada proceso tiene su propio
// repositorio en Bitbucket (y opcionalmente su propia carpeta y documentación).
//
// Forma (projects/{id}):
//   orchestrator: { folderPath }                       carpeta por defecto del proyecto
//   processes: [ {
//     id,                                              slug estable dentro del proyecto
//     label,                                           nombre legible ("Dispatcher")
//     orchestratorProcess,                             nombre del proceso en Orchestrator (lo completa el alta si falta)
//     role,                                            dispatcher | performer | reporter | other
//     folderPath,                                      opcional: solo si difiere de la carpeta del proyecto
//     repo: { workspace, slug, branch } | null,      null = no versionado: se controla, pero sin análisis de código
//     docs: { paths: [] }                              opcional: documentación propia del proceso
//   } ]
//   docs: { paths }                                    documentación común del proyecto (si la hay)
//
// Compatibilidad: un proyecto con el formato anterior (`repo` único, sin `processes`) se lee como
// un proyecto de un solo proceso.

export function slugProceso(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'proceso';
}

export function inferirRol(texto) {
  const t = String(texto || '').toLowerCase();
  if (/dispatch/.test(t)) return 'dispatcher';
  if (/perform/.test(t)) return 'performer';
  if (/report/.test(t)) return 'reporter';
  return 'other';
}

export function normalizarProyecto(p) {
  const proyecto = { ...p };
  let procesos = Array.isArray(p.processes) ? p.processes.filter(Boolean) : [];
  if (!procesos.length && p.repo && p.repo.slug) {
    procesos = [{ id: slugProceso(p.repo.slug), label: p.repo.slug, repo: p.repo, docs: p.docs }];
  }
  const usados = new Set();
  proyecto.processes = procesos.map((x, i) => {
    let id = x.id || slugProceso(x.label || x.orchestratorProcess || (x.repo && x.repo.slug) || `proceso-${i + 1}`);
    while (usados.has(id)) id = `${id}-${i + 1}`;
    usados.add(id);
    return {
      ...x,
      id,
      label: x.label || x.orchestratorProcess || (x.repo && x.repo.slug) || id,
      role: x.role || inferirRol(`${x.label || ''} ${x.orchestratorProcess || ''} ${(x.repo && x.repo.slug) || ''}`),
      folderPath: x.folderPath || null,
    };
  });
  return proyecto;
}

// Carpetas a consultar: la del proyecto más las que algún proceso declare distinta.
export function carpetasDe(p) {
  const n = normalizarProyecto(p);
  const base = n.orchestrator && n.orchestrator.folderPath;
  return [...new Set([base, ...n.processes.map((x) => x.folderPath)].filter(Boolean))];
}

// Nombres de proceso en Orchestrator declarados. Si TODOS los procesos los tienen, la colecta se
// limita a ellos (útil cuando la carpeta se comparte con otros proyectos); si falta alguno, se
// consulta la carpeta completa para no perder señales.
export function filtroDeProcesos(p) {
  const n = normalizarProyecto(p);
  if (!n.processes.length || n.processes.some((x) => !x.orchestratorProcess)) return null;
  return new Set(n.processes.map((x) => x.orchestratorProcess));
}

// Proceso del proyecto al que pertenece un nombre de proceso de Orchestrator (para elegir repo).
export function procesoPorNombre(p, nombreOrchestrator) {
  const n = normalizarProyecto(p);
  if (!nombreOrchestrator) return null;
  const exacto = n.processes.find((x) => x.orchestratorProcess && x.orchestratorProcess === nombreOrchestrator);
  if (exacto) return exacto;
  const rol = inferirRol(nombreOrchestrator);
  const porRol = rol !== 'other' ? n.processes.filter((x) => x.role === rol) : [];
  if (porRol.length === 1) return porRol[0];
  return n.processes.length === 1 ? n.processes[0] : null;
}

// Proyecto sin datos operativos, para escribir de vuelta solo la configuración.
export function configuracionDe(p) {
  const n = normalizarProyecto(p);
  return {
    processes: n.processes.map(({ id, label, orchestratorProcess, role, folderPath, repo, docs }) => ({
      id, label, orchestratorProcess: orchestratorProcess || null, role, folderPath: folderPath || null,
      repo: repo ? { workspace: repo.workspace, slug: repo.slug, branch: repo.branch || 'main' } : null,
      docs: { paths: (docs && docs.paths) || [] },
    })),
  };
}
