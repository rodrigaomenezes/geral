'use strict';
// F28 · RNF-012: a cor da marca (white-label) só vale se aguentar texto branco com contraste AA (4,5:1); a cor padrão
// do destaque passa. A conferência visual completa (contraste e foco em todas as telas) é o `npm run telas`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subir } = require('./ajuda');
const { contraste, corComTextoBranco } = require('../server/nucleo/cores');

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

test('contraste WCAG: preto/branco 21:1; cor clara recusada; cores padrão do Sinapse passam com texto branco', () => {
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
  assert.equal(corComTextoBranco('#ffd400'), undefined, 'amarelo não aguenta texto branco');
  assert.equal(corComTextoBranco('#1683d2'), undefined, 'o destaque antigo (4,03:1) não passava');
  assert.equal(corComTextoBranco('nada'), undefined);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const v of ['--destaque', '--marca', '--marca-escura']) {
    const cor = css.match(new RegExp(`${v}: (#[0-9a-f]{6})`, 'i'))[1];
    assert.ok(contraste(cor, '#ffffff') >= 4.5, `${v} ${cor} com texto branco`);
  }
});

test('marca da organização com cor de pouco contraste volta à cor padrão; a boa é mantida', async () => {
  await t.sql(`UPDATE tenants SET config = config || '{"marca": {"nome": "Brobot", "corPrimaria": "#0b4f8a", "corDestaque": "#f5e663"}}'::jsonb WHERE slug = 'brobot'`);
  const marina = await t.entrarComo('Marina Costa');
  const { usuario } = (await marina.get('/sessao')).corpo;
  assert.equal(usuario.marca.corPrimaria, '#0b4f8a');
  assert.equal(usuario.marca.corDestaque, undefined, 'amarelo-claro ignorado');
  await t.sql("UPDATE tenants SET config = config - 'marca' WHERE slug = 'brobot'");
});
