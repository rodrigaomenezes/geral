'use strict';
// Verificação estática sem dependência (R-17): sintaxe de todo .js do servidor, testes e telas,
// e as regras do projeto que dá para checar por texto (sem innerHTML, sem setInterval para regra).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = path.join(__dirname, '..');
const arquivos = [];
(function andar(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name);
    if (n.isDirectory()) { if (!['node_modules', 'vendor', 'data', 'fonts'].includes(n.name)) andar(p); } else if (n.name.endsWith('.js')) arquivos.push(p);
  }
})(raiz);
const problemas = [];
for (const a of arquivos) {
  const rel = path.relative(raiz, a);
  const modulo = rel.startsWith('public');
  try { execFileSync(process.execPath, ['--check', ...(modulo ? ['--input-type=module'] : []), ...(modulo ? [] : [a])], modulo ? { input: fs.readFileSync(a), stdio: ['pipe', 'pipe', 'pipe'] } : { stdio: 'pipe' }); }
  catch (e) { problemas.push(`${rel}: erro de sintaxe\n${String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')}`); }
  if (rel === path.join('scripts', 'verificar.js')) continue;
  const t = fs.readFileSync(a, 'utf8');
  if (modulo && /\.innerHTML\s*=/.test(t)) problemas.push(`${rel}: innerHTML (use h() de dom.js)`);
  if (!modulo && /\bsetInterval\s*\(/.test(t)) problemas.push(`${rel}: setInterval (rotina vai para a fila de jobs)`);
}
if (problemas.length) { console.error(problemas.join('\n')); process.exit(1); }
console.log(`verificar: ${arquivos.length} arquivos ok`);
