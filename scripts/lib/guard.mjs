// Reglas del hook de solo lectura (.claude/hooks/guard-solo-lectura.mjs), separadas para poder testearlas.
import { LECTURA_PERMITIDA, destinoPermitido } from './uip.mjs';

// Separa el comando en segmentos por ; && || | y saltos de línea.
function segmentos(cmd) {
  return cmd.split(/\n|;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
}

function tokens(seg) {
  return (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

export function revisar(comando, cwd = '') {
  for (const seg of segmentos(comando)) {
    const t = tokens(seg);
    // Saltar asignaciones de entorno y envoltorios comunes.
    let i = 0;
    while (i < t.length && (/^[A-Z_][A-Z0-9_]*=/.test(t[i]) || ['env', 'command', 'sudo', 'time'].includes(t[i]))) i++;
    const exe = (t[i] || '').split('/').pop();
    const args = t.slice(i + 1);

    if (exe === 'uip' || exe === 'uip.cmd' || exe === 'uipcli') {
      if (exe === 'uipcli') return 'uipcli no está permitido';
      const [a0, a1, a2] = args;
      if (!a0 || a0 === '--version' || a0 === '-v' || a0 === '--help') continue;
      if (a0 === 'login') { if (!a1 || a1 === 'status' || a1.startsWith('-')) continue; return `uip login ${a1} no está permitido`; }
      if (a0 === 'tools' && a1 === 'list') continue;
      if (a0 === 'skills' && ['list', 'show'].includes(a1)) continue;
      if (a0 === 'or' || a0 === 'orchestrator') {
        if (args.includes('--help') || args.includes('-h')) continue;
        const verbos = LECTURA_PERMITIDA[a1];
        if (!verbos || !verbos.includes(a2)) return `uip or ${a1 || ''} ${a2 || ''} modifica o expone datos sensibles; solo se permiten lecturas`;
        if (args.includes('--export')) return 'exportar logs a archivo no está permitido';
        const iD = args.findIndex((x) => x === '--destination' || x === '-d');
        if (a2 === 'download') {
          if (iD < 0 || !destinoPermitido(args[iD + 1])) return 'la descarga de paquetes o librerías solo se permite con --destination dentro de work/';
        } else if (iD >= 0) return '--destination solo se permite en descargas de paquetes o librerías hacia work/';
        continue;
      }
      return `uip ${a0} no está permitido en la rutina`;
    }

    if (exe === 'git') {
      const sub = args.find((x) => !x.startsWith('-') && !/^[\w.-]+=/.test(x) && x !== args[args.indexOf('-C') + 1]);
      const destinoC = args.includes('-C') ? args[args.indexOf('-C') + 1] : '';
      const enClon = /(^|\/)work\//.test(destinoC) || /\/work\//.test(cwd + '/');
      if (['push', 'commit', 'tag', 'merge', 'rebase'].includes(sub) && (enClon || /bitbucket\.org/.test(seg))) {
        return `git ${sub} sobre el código de un proyecto: la Torre de Control no modifica código`;
      }
    }

    if (exe === 'curl' || exe === 'wget' || exe === 'http' || exe === 'Invoke-RestMethod') {
      const hostSensible = /uipath\.com|bitbucket\.org/i.test(seg);
      const escritura = /(-X|--request)\s*(POST|PUT|PATCH|DELETE)/i.test(seg) || /\s(-d|--data[\w-]*|-F|--form)\s/.test(` ${seg} `);
      if (hostSensible && escritura && !/identity_\/connect\/token/.test(seg)) return 'llamada HTTP de escritura a UiPath o Bitbucket';
    }
  }
  return null;
}
