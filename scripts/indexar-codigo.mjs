#!/usr/bin/env node
// Índice de código de un proyecto, desde los paquetes de Orchestrator (determinista, sin modelo).
// Para cada proceso desplegado: librerías propias que usa (versión exacta, hasta 3 niveles), actividades
// de cada librería, si el paquete trae fuentes y documentación, e higiene de publicación.
// Solo LISTA los paquetes: lee content/project.json y nombres de archivo; no extrae código.
//
// Uso: node scripts/indexar-codigo.mjs --senales work/<run>/<id>/senales.json --proyecto <project.json> --salida work/<run>/<id>/indice.json [--todo]
//   Sin --todo, solo indexa procesos cuya versión cambió respecto de inventory.processes[].indexedVersion.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { arg, bandera, leerJson, desenvolver } from './lib/args.mjs';
import { descargar, listar, leerProjectJson, leerDependencias, actividadesDe, higiene, tieneFuentes, docsDe } from './lib/paquetes.mjs';

export function indexar({ procesos, inventario = [], todo = false }) {
  const errores = [];
  const libs = {};
  const salida = [];
  const indexarLib = (name, version, nivel) => {
    if (libs[name] && libs[name][version]) return libs[name][version];
    const f = descargar({ tipo: 'library', paquete: name, version });
    if (!f) { errores.push(`librería ${name}@${version}: no se pudo descargar`); return null; }
    const lista = listar(f);
    const pj = leerProjectJson(f);
    const deps = leerDependencias(pj);
    const info = { activities: actividadesDe(lista), hasSources: tieneFuentes(lista), dependencies: deps };
    (libs[name] ||= {})[version] = info;
    if (nivel < 3) for (const d of deps) indexarLib(d.name, d.version, nivel + 1);
    return info;
  };
  // Todas las librerías alcanzables desde un proceso (directas e indirectas), con su versión.
  const alcanzables = (deps, vistas = new Map()) => {
    for (const d of deps) {
      const k = `${d.name}@${d.version}`;
      if (vistas.has(k)) continue;
      vistas.set(k, d);
      const info = libs[d.name] && libs[d.name][d.version];
      if (info) alcanzables(info.dependencies, vistas);
    }
    return [...vistas.values()];
  };
  for (const p of procesos) {
    if (!p.paquete || !p.version) continue;
    const previo = inventario.find((x) => x.name === p.nombre);
    if (!todo && previo && previo.indexedVersion === p.version) continue;
    const f = descargar({ tipo: 'process', paquete: p.paquete, version: p.version, carpeta: p.carpeta });
    if (!f) { errores.push(`proceso ${p.nombre} (${p.paquete}@${p.version}): no se pudo descargar el paquete`); continue; }
    const lista = listar(f);
    const deps = leerDependencias(leerProjectJson(f));
    for (const d of deps) indexarLib(d.name, d.version, 1);
    salida.push({
      name: p.nombre, package: p.paquete, version: p.version, indexedVersion: p.version,
      libraries: alcanzables(deps.filter((d) => libs[d.name])).map(({ name, version }) => ({ name, version })),
      hasSources: tieneFuentes(lista), docs: docsDe(lista).map((e) => e.slice('content/'.length)), hygiene: higiene(lista),
    });
  }
  return { procesos: salida, libraries: libs, errores };
}

if (process.argv[1] && process.argv[1].endsWith('indexar-codigo.mjs')) {
  const senales = leerJson(arg('--senales'));
  const proyecto = desenvolver(leerJson(arg('--proyecto')));
  const r = indexar({ procesos: senales.procesos || [], inventario: (proyecto.inventory && proyecto.inventory.processes) || [], todo: bandera('--todo') });
  mkdirSync(dirname(arg('--salida')), { recursive: true });
  writeFileSync(arg('--salida'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ procesos: r.procesos.map((p) => `${p.name}@${p.version}`), librerias: Object.keys(r.libraries), errores: r.errores.length }));
}
