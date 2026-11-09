#!/usr/bin/env bash
# Setup script del entorno cloud "momentum-operaciones".
#
# Se copia tal cual en: entorno cloud > Edit > Setup script.
# Corre al iniciar cada contenedor, ANTES de la sesión de Claude.
# Importante: el setup script NO tiene acceso a los secretos del entorno, por eso
# aquí solo se instala software; el login a UiPath lo hace la rutina en tiempo de ejecución.
#
# Validado en Fase 0.A (2026-11-09) en un contenedor Linux de Claude cloud con Node 22.
set -euo pipefail

UIP_VERSION="1.205.0"

# Sin telemetría (además, el proxy del entorno la bloquea) y sin auto-actualización silenciosa.
export UIPATH_TELEMETRY_DISABLED=true
export UIPATH_CLI_DISABLE_VERSION_SYNC=true

# 1) CLI de UiPath, fijado. Sin el 'config set version' el CLI se auto-actualiza al primer comando.
npm i -g "@uipath/cli@${UIP_VERSION}"
uip config set version "${UIP_VERSION}" >/dev/null

# 2) Tool de Orchestrator (comandos 'uip or ...'). Respeta la línea de versión fijada arriba.
uip tools install @uipath/orchestrator-tool >/dev/null

# 3) Skills oficiales de UiPath (licencia MIT, paquete npm @uipath/skills).
#    Solo las útiles para diagnóstico; el resto (maestro, agents, feedback, ...) sería ruido.
#    'uip skills install --agent claude' no admite instalación local y registra las 32 skills,
#    por eso se copian solo las elegidas al directorio de skills de usuario.
tmp="$(mktemp -d)"
( cd "$tmp" && npm pack "@uipath/skills@${UIP_VERSION}" >/dev/null && tar -xzf uipath-skills-*.tgz )
mkdir -p "${HOME}/.claude/skills"
for s in uipath-troubleshoot uipath-platform uipath-rpa; do
  rm -rf "${HOME}/.claude/skills/${s}"
  cp -r "${tmp}/package/skills/${s}" "${HOME}/.claude/skills/"
done
rm -rf "$tmp"

uip --version
