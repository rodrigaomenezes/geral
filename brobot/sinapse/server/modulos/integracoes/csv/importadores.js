'use strict';
// Importações por CSV (fase atual da integração com Platform e OMIE: extração de um lado, importação do outro).
// Cada tipo declara as colunas, valida cada linha (erro diz a linha e o motivo) e aplica de forma idempotente.
// `aplicar` recebe as linhas válidas e roda na mesma transação: ou entra o arquivo inteiro válido, ou nada.

const { uma } = require('../../../db');
const { relogio, DIA } = require('../../../nucleo/relogio');
const { normalizarErro } = require('../../rodadas/erros');
const csv = require('./csv');

const STATUS_CRED = { ok: 'ok', valida: 'ok', ativo: 'ok', ausente: 'ausente', faltando: 'ausente', invalida: 'invalida', expirada: 'expirada', vencida: 'expirada',
  '2fa': '2fa_pendente', '2fa_pendente': '2fa_pendente', vinculo_sne: 'vinculo_sne', sem_vinculo_sne: 'vinculo_sne' };
const TIPO_CRED = { certificado: 'certificado', govbr: 'govbr', gov_br: 'govbr', sne: 'sne', portal_detran: 'portal_detran', detran: 'portal_detran' };
const SITUACAO = { em_dia: 'em_dia', adimplente: 'em_dia', ok: 'em_dia', em_atraso: 'em_atraso', inadimplente: 'em_atraso', atrasado: 'em_atraso' };
const chave = (v) => csv.normalizarCabecalho(v || '');

async function contasPorCnpj(c, cnpjs) {
  const r = await c.query('SELECT id, cnpj, nome FROM contas WHERE cnpj = ANY($1) AND arquivada_em IS NULL', [[...new Set(cnpjs.filter(Boolean))]]);
  return new Map(r.rows.map((x) => [x.cnpj, x]));
}

const TIPOS = {
  platform_rodada: {
    nome: 'Platform → resultado de rodada por veículo (pré-rodada D-4 ou rodada oficial D0)',
    origem: 'platform',
    colunas: ['rodada', 'cnpj', 'produto', 'data_rodada', 'fase', 'placa', 'resultado', 'codigo_erro'],
    exemplo: 'rodada;cnpj;produto;data_rodada;fase;placa;resultado;codigo_erro\nRD-123;12345678000190;Multas e Notificações;08/11/2026;pre;RSU2B34;erro;SNE_VINCULO_AUSENTE',
    validar(v) {
      const e = [];
      if (!v.rodada) e.push('rodada vazia');
      if (!csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (!csv.data(v.data_rodada)) e.push('data_rodada inválida (use dd/mm/aaaa)');
      if (!['pre', 'pre_rodada', 'oficial', 'd0'].includes(chave(v.fase))) e.push('fase deve ser "pre" ou "oficial"');
      if (!v.placa) e.push('placa vazia');
      if (!['ok', 'sucesso', 'erro', 'falha'].includes(chave(v.resultado))) e.push('resultado deve ser "ok" ou "erro"');
      if (['erro', 'falha'].includes(chave(v.resultado)) && !v.codigo_erro) e.push('código do erro vazio');
      return e;
    },
    async aplicar(c, ctx, linhas, { rodadas }) {
      const contas = await contasPorCnpj(c, linhas.map((l) => csv.cnpj(l.valores.cnpj)));
      const grupos = new Map();
      const erros = [];
      for (const l of linhas) {
        const v = l.valores; const conta = contas.get(csv.cnpj(v.cnpj));
        if (!conta) { erros.push({ linha: l.numero, erro: `CNPJ ${v.cnpj} não é cliente no Sinapse` }); continue; }
        const fase = ['pre', 'pre_rodada'].includes(chave(v.fase)) ? 'pre' : 'oficial';
        const k = `${v.rodada}|${fase}`;
        if (!grupos.has(k)) grupos.set(k, { idPlatform: v.rodada, fase, conta, produto: v.produto || 'Rodada', d0: csv.data(v.data_rodada), veiculos: new Map() });
        grupos.get(k).veiculos.set(v.placa.toUpperCase(), { placa: v.placa.toUpperCase(), ok: ['ok', 'sucesso'].includes(chave(v.resultado)), codigoPlatform: v.codigo_erro || null });
      }
      const resumo = [];
      for (const g of [...grupos.values()].sort((a, b) => (a.fase === 'pre' ? -1 : 1) - (b.fase === 'pre' ? -1 : 1))) {
        let r = uma(await c.query('SELECT id FROM rodadas WHERE id_platform = $1', [g.idPlatform]));
        if (!r) {
          r = uma(await c.query(`INSERT INTO rodadas (tenant_id, conta_id, id_platform, produto, agendada_para, fonte) VALUES ($1,$2,$3,$4,$5,'csv') RETURNING id`,
            [ctx.tenantId, g.conta.id, g.idPlatform, g.produto, g.d0]));
        } else {
          await c.query("UPDATE rodadas SET fonte = 'csv' WHERE id = $1", [r.id]);
        }
        const rodada = await rodadas.buscarRodada(c, r.id, true);
        const resultado = [...g.veiculos.values()];
        if (g.fase === 'pre') {
          if (rodada.estado !== 'agendada') { resumo.push(`${g.idPlatform}: pré-rodada já registrada antes (ignorada)`); continue; }
          await rodadas.processarPreRodada(c, ctx, rodada, resultado);
        } else {
          if (['executada', 'concluida'].includes(rodada.estado)) { resumo.push(`${g.idPlatform}: rodada oficial já registrada antes (ignorada)`); continue; }
          await rodadas.processarOficial(c, ctx, rodada, resultado);
        }
        resumo.push(`${g.idPlatform} (${g.conta.nome}) · ${g.fase === 'pre' ? 'pré-rodada' : 'rodada oficial'}: ${resultado.length} veículo(s), ${resultado.filter((x) => !x.ok).length} com erro`);
      }
      return { resumo, erros };
    },
  },

  platform_credenciais: {
    nome: 'Platform → status das credenciais por cliente (sem senha nem certificado)',
    origem: 'platform',
    colunas: ['cnpj', 'tipo', 'status', 'expira_em', 'referencia'],
    exemplo: 'cnpj;tipo;status;expira_em;referencia\n12345678000190;certificado;expirada;30/10/2026;cred-123',
    validar(v) {
      const e = [];
      if (!csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (!TIPO_CRED[chave(v.tipo)]) e.push(`tipo desconhecido (use: ${Object.keys(TIPO_CRED).join(', ')})`);
      if (!STATUS_CRED[chave(v.status)]) e.push(`status desconhecido (use: ${Object.keys(STATUS_CRED).join(', ')})`);
      if (v.expira_em && !csv.data(v.expira_em)) e.push('expira_em inválida');
      if (/senha|password|\bpin\b/i.test(Object.keys(v).join(' '))) e.push('o arquivo tem coluna de senha: o Sinapse não guarda segredos (CRE-007)');
      return e;
    },
    async aplicar(c, ctx, linhas) {
      const contas = await contasPorCnpj(c, linhas.map((l) => csv.cnpj(l.valores.cnpj)));
      const erros = []; let n = 0;
      for (const l of linhas) {
        const v = l.valores; const conta = contas.get(csv.cnpj(v.cnpj));
        if (!conta) { erros.push({ linha: l.numero, erro: `CNPJ ${v.cnpj} não é cliente no Sinapse` }); continue; }
        const exp = v.expira_em ? csv.data(v.expira_em).toISOString().slice(0, 10) : null;
        await c.query(`INSERT INTO credenciais_ref (tenant_id, conta_id, tipo, status, expira_em, referencia_platform) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (tenant_id, conta_id, tipo) DO UPDATE SET status = EXCLUDED.status, expira_em = EXCLUDED.expira_em,
            referencia_platform = EXCLUDED.referencia_platform, atualizado_em = now()`,
        [ctx.tenantId, conta.id, TIPO_CRED[chave(v.tipo)], STATUS_CRED[chave(v.status)], exp, v.referencia || `csv-${conta.id.slice(0, 8)}-${chave(v.tipo)}`]);
        n++;
      }
      return { resumo: [`${n} credencial(is) atualizada(s)`], erros };
    },
  },

  platform_uso: {
    nome: 'Platform → uso por cliente (último login, usuários ativos, consultas em 30 dias, módulos usados)',
    origem: 'platform',
    colunas: ['cnpj', 'ultimo_login', 'usuarios_ativos', 'consultas_30d', 'modulos'],
    exemplo: 'cnpj;ultimo_login;usuarios_ativos;consultas_30d;modulos\n12345678000190;03/11/2026 09:15;12;8450;multas, indicacao_condutores',
    validar(v) {
      const e = [];
      if (!csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (v.ultimo_login && !csv.data(v.ultimo_login)) e.push('ultimo_login inválido');
      for (const n of ['usuarios_ativos', 'consultas_30d']) if (v[n] && !/^\d+$/.test(v[n])) e.push(`${n} deve ser número inteiro`);
      return e;
    },
    async aplicar(c, ctx, linhas) {
      const contas = await contasPorCnpj(c, linhas.map((l) => csv.cnpj(l.valores.cnpj)));
      const erros = []; let n = 0;
      for (const l of linhas) {
        const v = l.valores; const conta = contas.get(csv.cnpj(v.cnpj));
        if (!conta) { erros.push({ linha: l.numero, erro: `CNPJ ${v.cnpj} não é cliente no Sinapse` }); continue; }
        await c.query(`INSERT INTO uso_contas (tenant_id, conta_id, ultimo_login, usuarios_ativos, consultas_30d, modulos_usados, atualizado_em)
          VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (tenant_id, conta_id) DO UPDATE SET ultimo_login = EXCLUDED.ultimo_login,
          usuarios_ativos = EXCLUDED.usuarios_ativos, consultas_30d = EXCLUDED.consultas_30d, modulos_usados = EXCLUDED.modulos_usados, atualizado_em = now()`,
        [ctx.tenantId, conta.id, csv.data(v.ultimo_login), v.usuarios_ativos ? Number(v.usuarios_ativos) : null, v.consultas_30d ? Number(v.consultas_30d) : null,
          String(v.modulos || '').split(',').map((x) => chave(x)).filter(Boolean)]);
        n++;
      }
      return { resumo: [`Uso atualizado de ${n} cliente(s)`], erros };
    },
  },

  omie_clientes: {
    nome: 'OMIE → situação financeira por cliente (código OMIE, CNPJ, situação)',
    origem: 'omie',
    colunas: ['codigo_omie', 'cnpj', 'situacao'],
    exemplo: 'codigo_omie;cnpj;situacao\nOM-501;12345678000190;em_dia',
    validar(v) {
      const e = [];
      if (!v.codigo_omie) e.push('codigo_omie vazio');
      if (!csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (!SITUACAO[chave(v.situacao)]) e.push(`situação desconhecida (use: ${Object.keys(SITUACAO).join(', ')})`);
      return e;
    },
    async aplicar(c, ctx, linhas) {
      const contas = await contasPorCnpj(c, linhas.map((l) => csv.cnpj(l.valores.cnpj)));
      const erros = []; let n = 0; let vinculados = 0;
      for (const l of linhas) {
        const v = l.valores; const conta = contas.get(csv.cnpj(v.cnpj));
        if (!conta) {
          // FIN-008: cliente do OMIE sem conta no Sinapse vira divergência para tratar (não cria conta por inferência).
          await c.query(`INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1, 'omie_sem_conta', $2, $3, $4)
            ON CONFLICT (tenant_id, chave) DO NOTHING`, [ctx.tenantId, `Cliente OMIE ${v.codigo_omie} (CNPJ ${v.cnpj}) não existe no Sinapse.`, v.codigo_omie, `omie-csv:${v.codigo_omie}`]);
          erros.push({ linha: l.numero, erro: `CNPJ ${v.cnpj} sem conta no Sinapse (registrado em divergências)` });
          continue;
        }
        const atual = uma(await c.query('SELECT id_omie, nome FROM contas WHERE id = $1', [conta.id]));
        // FIN-002: código OMIE nunca é trocado nem repetido em silêncio — divergência para o Financeiro decidir.
        if (atual.id_omie && atual.id_omie !== v.codigo_omie) {
          await divergir(c, ctx, 'omie_codigo_diferente', `Conta ${atual.nome} está ligada ao cliente OMIE ${atual.id_omie}, mas o arquivo traz ${v.codigo_omie} para o CNPJ ${v.cnpj}.`,
            conta.id, `omie-codigo-diferente:${conta.id}:${v.codigo_omie}`);
          erros.push({ linha: l.numero, erro: `A conta já tem o código OMIE ${atual.id_omie}; o arquivo traz ${v.codigo_omie} (registrado em divergências, nada foi trocado)` });
          continue;
        }
        if (!atual.id_omie) {
          const outra = uma(await c.query('SELECT id, nome FROM contas WHERE id_omie = $1 AND id <> $2 AND arquivada_em IS NULL', [v.codigo_omie, conta.id]));
          if (outra) {
            await divergir(c, ctx, 'omie_codigo_em_outra_conta', `O cliente OMIE ${v.codigo_omie} (CNPJ ${v.cnpj}) já está ligado à conta ${outra.nome}.`,
              conta.id, `omie-codigo-outra:${v.codigo_omie}:${conta.id}`);
            erros.push({ linha: l.numero, erro: `O código OMIE ${v.codigo_omie} já está na conta ${outra.nome} (registrado em divergências)` });
            continue;
          }
          await c.query('UPDATE contas SET id_omie = $2, atualizado_em = now() WHERE id = $1', [conta.id, v.codigo_omie]); vinculados++;
        }
        await c.query(`INSERT INTO status_financeiro (tenant_id, conta_id, situacao, fonte, sincronizado_em) VALUES ($1,$2,$3,'omie_csv',$4)
          ON CONFLICT (tenant_id, conta_id) DO UPDATE SET situacao = EXCLUDED.situacao, fonte = EXCLUDED.fonte, sincronizado_em = EXCLUDED.sincronizado_em`,
        [ctx.tenantId, conta.id, SITUACAO[chave(v.situacao)], relogio.agora()]);
        n++;
      }
      return { resumo: [`Situação financeira de ${n} cliente(s) atualizada`, `${vinculados} código(s) OMIE vinculado(s)`], erros };
    },
  },
  platform_consultas: {
    nome: 'Platform → volumetria de consultas por cliente, produto e dia (esperadas, geradas, erros) — erros invisíveis e robô parado',
    origem: 'platform',
    colunas: ['cnpj', 'produto', 'data', 'esperadas', 'geradas', 'erros_tecnicos', 'erros_usuario', 'indisponiveis'],
    opcionais: ['erros_tecnicos', 'erros_usuario', 'indisponiveis'],
    exemplo: 'cnpj;produto;data;esperadas;geradas;erros_tecnicos;erros_usuario;indisponiveis\n12345678000190;Multas e Notificações;04/11/2026;620;598;3;12;0',
    validar(v) {
      const e = [];
      const inteiro = (x) => x === undefined || x === '' || /^\d{1,9}$/.test(String(x).trim());
      if (!csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (!v.produto) e.push('produto vazio');
      if (!csv.data(v.data)) e.push('data inválida (use dd/mm/aaaa)');
      for (const k of ['esperadas', 'geradas']) if (!/^\d{1,9}$/.test(String(v[k] ?? '').trim())) e.push(`${k}: número inteiro`);
      for (const k of ['erros_tecnicos', 'erros_usuario', 'indisponiveis']) if (!inteiro(v[k])) e.push(`${k}: número inteiro`);
      return e;
    },
    async aplicar(c, ctx, linhas, { monitoramento }) {
      const contas = await contasPorCnpj(c, linhas.map((l) => csv.cnpj(l.valores.cnpj)));
      const erros = []; const validas = [];
      const n = (x) => Number(String(x || '0').trim()) || 0;
      for (const l of linhas) {
        const v = l.valores; const conta = contas.get(csv.cnpj(v.cnpj));
        if (!conta) { erros.push({ linha: l.numero, erro: `CNPJ ${v.cnpj} não é cliente no Sinapse` }); continue; }
        validas.push({ contaId: conta.id, produto: v.produto.trim().slice(0, 80), dia: csv.data(v.data).toISOString().slice(0, 10), esperadas: n(v.esperadas),
          geradas: n(v.geradas), errosTecnicos: n(v.erros_tecnicos), errosUsuario: n(v.erros_usuario), indisponiveis: n(v.indisponiveis) });
      }
      await monitoramento.registrarVolumes(c, ctx, validas);
      const pares = [...new Map(validas.map((x) => [`${x.contaId}|${x.produto}`, { contaId: x.contaId, produto: x.produto }])).values()];
      const r = await monitoramento.avaliarConsultas(c, ctx, pares);
      return { resumo: [`${validas.length} dia(s) de volumetria registrado(s) em ${r.avaliados} conta×produto`,
        `${r.alertasNovos} alerta(s) novo(s) aberto(s) como ocorrência`, `${r.jaAbertos} alerta(s) que já estavam abertos (sem repetir)`], erros };
    },
  },
  pipedrive_negocios: {
    nome: 'Pipedrive → negócios em aberto (migração do Comercial; ganhos e perdidos ficam para a migração completa)',
    origem: 'pipedrive',
    // Só a gestão comercial migra a carteira de negócios (além de usar as integrações).
    permissao: 'comercial.gerir',
    colunas: ['id', 'organizacao', 'status', 'titulo', 'cnpj', 'valor', 'etapa', 'responsavel_email', 'contato', 'telefone', 'email', 'criado_em', 'observacoes'],
    opcionais: ['titulo', 'cnpj', 'valor', 'etapa', 'responsavel_email', 'contato', 'telefone', 'email', 'criado_em', 'observacoes'],
    exemplo: 'id;organizacao;status;titulo;cnpj;valor;etapa;responsavel_email;contato;telefone;email;criado_em;observacoes\n'
      + '1234;Transportes Exemplo;open;Frota 200 placas;11222333000144;4500,00;Proposta enviada;comercial@brobot.com.br;Ana;11 98888-7777;ana@exemplo.com.br;15/10/2026;Pediu desconto',
    validar(v) {
      const e = [];
      if (!/^[\w.-]{1,40}$/.test(v.id || '')) e.push('id do negócio no Pipedrive vazio ou inválido');
      if (!v.organizacao || v.organizacao.length < 2) e.push('organização vazia');
      if (!['open', 'aberto', 'em_aberto', 'won', 'ganho', 'lost', 'perdido'].includes(chave(v.status))) e.push('status deve ser open, won ou lost');
      else if (!['open', 'aberto', 'em_aberto'].includes(chave(v.status))) e.push('negócio ganho ou perdido: o histórico fechado entra na migração completa (aguarda a exportação real)');
      if (v.cnpj && !csv.cnpj(v.cnpj)) e.push('CNPJ inválido');
      if (v.valor && !(Number(String(v.valor).replace(/\./g, '').replace(',', '.')) >= 0)) e.push('valor inválido');
      if (v.criado_em && !csv.data(v.criado_em)) e.push('criado_em inválido (use dd/mm/aaaa)');
      return e;
    },
    async aplicar(c, ctx, linhas, { comercial }) {
      return comercial.importarDoPipedrive(c, ctx, linhas.map((l) => ({ ...l.valores, numero: l.numero,
        valor: l.valores.valor ? Number(String(l.valores.valor).replace(/\./g, '').replace(',', '.')) : undefined, // 4.500,00 → 4500 cnpj: csv.cnpj(l.valores.cnpj) || undefined,
        criado_em: l.valores.criado_em ? csv.data(l.valores.criado_em) : undefined })));
    },
  },
};

async function divergir(c, ctx, tipo, descricao, entidadeId, chave) {
  await c.query('INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, chave) DO NOTHING',
    [ctx.tenantId, tipo, descricao.slice(0, 500), entidadeId, chave]);
}

module.exports = { TIPOS, DIA };
