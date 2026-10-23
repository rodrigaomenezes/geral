'use strict';
// Gravação segura de arquivos de estado (cadastros, links, dossiês): escreve num temporário e troca de uma vez.
// Se o processo cair no meio (reinício do Railway, falta de disco), fica o arquivo anterior inteiro, nunca um pela metade.

const fs = require('node:fs');

function gravarAtomico(arquivo, conteudo, opcoes) {
  const temporario = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, conteudo, opcoes);
  fs.renameSync(temporario, arquivo);
}

module.exports = { gravarAtomico };
