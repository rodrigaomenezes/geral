## O que muda
Projeto: (ex.: `brobot/estadia`)

## Impacto (Política de Engenharia — `docs/POLITICA_ENGENHARIA.md`)
- Quem usa o que mudou (rotas, eventos, arquivos de dados, telas, app Android):
- Contrato quebrado? (se sim: plano de migração e decisão em `DECISIONS.md`)
- Forma do sistema mudou? (`ARCHITECTURE.md`)

## Verificações (resultado real; o que não rodou fica "não executado")
- [ ] `npm test` no projeto: resultado:
- [ ] Tela conferida em 360 px

## Checklist
- [ ] Nenhum evento editado ou apagado; nada que apague dado real
- [ ] Permissão no servidor; cada organização vê só o que é dela
- [ ] Entrada validada; repetir a ação não duplica
- [ ] Nenhum segredo ou dado sensível em código, log ou PR
- [ ] Sem camada, dependência ou serviço novo sem justificativa
- [ ] Documentação atualizada

## Deficiências encontradas (problema → consequência → correção mínima)
