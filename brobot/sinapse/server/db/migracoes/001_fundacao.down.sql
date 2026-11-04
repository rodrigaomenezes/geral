-- Volta da 001. Apaga a estrutura inteira: use só em ambiente de demonstração ou após backup verificado.
DROP TABLE IF EXISTS sistema, demo_omie, demo_platform_veiculos, divergencias, integracoes, jobs, auditoria, eventos,
  tarefas, contatos_programados, pendencias, rodadas, handoffs, interacoes, ocorrencia_vinculos, ocorrencia_itens,
  ocorrencias, entradas, status_financeiro, credenciais_ref, pontos_focais, contas, feriados, contadores, sessoes,
  usuarios, equipes, tenants CASCADE;
DROP FUNCTION IF EXISTS auditoria_imutavel();
