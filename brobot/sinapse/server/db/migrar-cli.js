'use strict';
// Uso: npm run migrar            → aplica as migrações pendentes
//      npm run migrar -- voltar  → desfaz a última (pede SINAPSE_CONFIRMAR_VOLTA=sim)
const { abrirBanco } = require('./index');
const { migrar, voltar } = require('./migrar');
const { carregarConfig } = require('../config');

(async () => {
  const cfg = carregarConfig();
  const db = await abrirBanco({ url: cfg.databaseUrl, dir: cfg.dirDados });
  try {
    if (process.argv[2] === 'voltar') {
      if (process.env.SINAPSE_CONFIRMAR_VOLTA !== 'sim') {
        console.error('Para desfazer a última migração, defina SINAPSE_CONFIRMAR_VOLTA=sim (faça backup antes).');
        process.exitCode = 1;
        return;
      }
      console.log('desfeita:', (await voltar(db)) || 'nenhuma');
    } else {
      const feitas = await migrar(db, console.log);
      console.log(feitas.length ? `${feitas.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
    }
  } finally {
    await db.fechar();
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
