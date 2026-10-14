'use strict';
// Dados iniciais de demonstração do Estadia BR (todos fictícios).

const crypto = require('node:crypto');
const Amelia = require('./amelia');
const C = require('./cadastros');
const zlib = require('node:zlib');

const SENHA_DEMO = 'estadia123';
const PIN_DEMO = '1234';
const CD_JUNDIAI = { lat: -23.18571, lng: -46.89784 };
const USINA_UBERLANDIA = { lat: -18.91861, lng: -48.27722 };

// PNG mínimo sem dependências, desenhado por uma função de pintura.
function png(w, h, paint) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  paint({ set, rect, w, h });
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function demoPhotoPng(w = 320, h = 200) {
  return png(w, h, ({ rect, set }) => {
    rect(0, 0, w, 150, [201, 216, 230]); rect(0, 150, w, h, [93, 102, 112]);
    for (let x = 0; x < w; x += 34) rect(x, 168, x + 20, 172, [232, 225, 200]);
    rect(18, 60, 28, 152, [42, 47, 53]);
    for (let x = 28; x < 148; x += 24) { rect(x, 72, x + 12, 80, [242, 169, 0]); rect(x + 12, 72, x + 24, 80, [26, 26, 26]); }
    rect(150, 70, 278, 142, [230, 233, 236]); rect(278, 92, 312, 142, [47, 109, 179]); rect(286, 98, 306, 114, [188, 211, 234]);
    for (const cx of [176, 200, 296]) for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) if (x * x + y * y <= 100) set(cx + x, 148 + y, [29, 33, 38]);
  });
}

function demoDocPng(w = 240, h = 320) {
  return png(w, h, ({ rect }) => {
    rect(0, 0, w, h, [120, 128, 136]); rect(20, 16, w - 20, h - 16, [250, 250, 246]);
    rect(36, 34, 150, 46, [40, 40, 40]);
    for (let y = 70; y < 250; y += 18) rect(36, y, 36 + ((y * 37) % 120) + 60, y + 6, [150, 150, 150]);
    rect(36, 268, 120, 296, [45, 98, 170]); rect(140, 276, 204, 280, [60, 60, 60]);
  });
}

function seed(dir, store, { quiet = false } = {}) {
  const o = {
    adm: dir.addOrg({ id: 'estadia-br', nome: 'Estadia BR · Administração', tipo: 'admin' }),
    rodovia: dir.addOrg({ id: 'rodovia-sul', nome: 'Rodovia Sul Transportes', tipo: 'transportadora' }),
    serra: dir.addOrg({ id: 'serra-azul', nome: 'Atacadista Serra Azul · CD Jundiaí', tipo: 'destino' }),
    usina: dir.addOrg({ id: 'usina-boa-vista', nome: 'Usina Boa Vista · Uberlândia', tipo: 'destino' }),
    horizonte: dir.addOrg({ id: 'horizonte', nome: 'Mercado Horizonte · CD Campinas', tipo: 'destino' }),
    adv: dir.addOrg({ id: 'andrade-prado', nome: 'Andrade & Prado Advogados', tipo: 'advocacia' }),
    tac: dir.addOrg({ id: 'tac-autonomos', nome: 'Transportadores autônomos', tipo: 'tac' }),
  };
  const u = {
    admin: dir.addUser({ email: 'admin@estadiabr.demo', senha: SENHA_DEMO, nome: 'Administração Estadia BR', role: 'admin', orgId: o.adm.id }),
    carla: dir.addUser({ email: 'operacao@rodoviasul.demo', senha: SENHA_DEMO, nome: 'Carla Mendes', role: 'transportadora', orgId: o.rodovia.id }),
    marina: dir.addUser({ email: 'portaria@serraazul.demo', senha: SENHA_DEMO, nome: 'Marina Coelho', role: 'destino', orgId: o.serra.id }),
    rafael: dir.addUser({ email: 'doca@serraazul.demo', senha: SENHA_DEMO, nome: 'Rafael Toledo', role: 'destino', orgId: o.serra.id }),
    usina: dir.addUser({ email: 'expedicao@usinaboavista.demo', senha: SENHA_DEMO, nome: 'Sérgio Lima', role: 'destino', orgId: o.usina.id }),
    paulo: dir.addUser({ email: 'cd@horizonte.demo', senha: SENHA_DEMO, nome: 'Paulo Reis', role: 'destino', orgId: o.horizonte.id }),
    joao: dir.addUser({ email: 'joao@tac.demo', senha: SENHA_DEMO, nome: 'João Batista Ferreira', role: 'tac', orgId: o.tac.id, placa: 'RTB4F27', telefone: '+55 11 98888-0001', pin: PIN_DEMO }),
    ana: dir.addUser({ email: 'ana@tac.demo', senha: SENHA_DEMO, nome: 'Ana Lúcia Prado', role: 'tac', orgId: o.tac.id, placa: 'QPE2H91', telefone: '+55 11 98888-0002', pin: PIN_DEMO }),
    adv: dir.addUser({ email: 'juridico@andradeprado.demo', senha: SENHA_DEMO, nome: 'Dra. Helena Andrade', role: 'advocacia', orgId: o.adv.id }),
  };
  // Frota: conjuntos dos motoristas e da transportadora (tabelas de veículos e implementos).
  const conj = (dados, dono) => dir.salvarConjunto(C.validarConjunto(dados), dono);
  conj({ composicao: 'CARRETA', placaVeiculo: 'RTB4F27', placasImplementos: ['RTC5A12'], carroceria: 'SIDER', capacidadeToneladas: 30, categoriaVeiculo: '6X2', marca: 'Scania', modelo: 'R 450', ano: 2019 }, { orgId: o.tac.id, userId: u.joao.id });
  conj({ composicao: 'CARRETA', placaVeiculo: 'QPE2H91', placasImplementos: ['QPF3B77'], carroceria: 'SIDER', capacidadeToneladas: 30, categoriaVeiculo: '6X2', marca: 'Volvo', modelo: 'FH 460', ano: 2021 }, { orgId: o.tac.id, userId: u.ana.id });
  conj({ composicao: 'BITREM', placaVeiculo: 'RSU2C45', placasImplementos: ['RSV4D11', 'RSV4D12'], carroceria: 'GRANELEIRO', capacidadeToneladas: 37, categoriaVeiculo: '6X4', apelido: 'Bitrem 01' }, { orgId: o.rodovia.id });
  conj({ composicao: 'TRUCK', placaVeiculo: 'RSA7E90', placasImplementos: [], carroceria: 'BAU', capacidadeToneladas: 14, apelido: 'Truck baú 03' }, { orgId: o.rodovia.id });
  const carreta = (placa, imp) => ({ composicao: 'CARRETA', carroceria: 'SIDER', placasImplementos: [imp], implemento: 'Carreta · Sider' });
  const actor = (x) => ({ userId: x.id, name: x.nome, role: x.role, orgId: x.orgId });
  const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d; };
  const at = (offset, hh, mm) => { const d = day(offset); d.setUTCHours(hh + 3, mm, 0, 0); return d.toISOString(); }; // horário de Brasília
  const createOp = (payload, when) => {
    const opId = crypto.randomUUID();
    const dest = dir.org(payload.destinoOrgId);
    store.append({ opId, type: 'OPERACAO_CRIADA', actor: actor(u.carla), origem: 'portal', occurredAt: when, receivedAt: when,
      payload: { transportadoraOrgId: o.rodovia.id, transportadoraNome: o.rodovia.nome, transportadoraContatoNome: 'Carla Mendes', transportadoraContatoTelefone: '+55 11 90000-0010', destinoNome: dest.nome, ...payload } });
    return opId;
  };
  const todayStart = at(0, 5, 0) < new Date().toISOString() ? at(0, 5, 0) : new Date().toISOString();

  // 1) Operação pronta para a demonstração ao vivo.
  createOp({ codigo: 'OP-2026-0001', tipo: 'DESCARGA', destinoOrgId: o.serra.id, placa: 'RTB4F27', ...carreta('RTB4F27', 'RTC5A12'), tipoCarga: 'CARGA_GERAL', capacidadeToneladas: 30,
    pesoToneladas: 28, mercadoria: 'açúcar cristal', volume: '560 sacas', nfe: '35261000184552', cte: '35261000099871', mdfe: '35261000044120',
    origem: 'Ribeirão Preto/SP', localNome: 'CD Jundiaí · Doca 7', ...CD_JUNDIAI, dataPrevista: at(0, 9, 0),
    responsavelNome: 'Marina Coelho', responsavelTelefone: '+55 11 90000-0001' }, todayStart);

  // 2) Operação de outro destino (isolamento entre organizações).
  createOp({ codigo: 'OP-2026-0002', tipo: 'DESCARGA', destinoOrgId: o.horizonte.id, placa: 'QPE2H91', ...carreta('QPE2H91', 'QPF3B77'), tipoCarga: 'CARGA_GERAL', capacidadeToneladas: 24,
    pesoToneladas: 22, mercadoria: 'bebidas', nfe: '35261000201118', origem: 'Sorocaba/SP', localNome: 'CD Campinas · Doca 2', lat: -22.90556, lng: -47.06083,
    responsavelNome: 'Paulo Reis', responsavelTelefone: '+55 19 90000-0002' }, todayStart);

  const photo = store.savePhoto(demoPhotoPng(), 'image/png');
  const doc = store.savePhoto(demoDocPng(), 'image/png');
  const near = (base, dLat, dLng, acc = 8) => ({ lat: +(base.lat + dLat).toFixed(6), lng: +(base.lng + dLng).toFixed(6), acc });
  const mk = (opId) => (type, by, t, extra = {}, recv) => store.append({ opId, type, actor: by.id ? actor(by) : by, origem: extra.origem || (by.role === 'tac' ? 'app' : 'portal'),
    occurredAt: at(...t), receivedAt: recv ? at(...recv) : at(...t), refEventId: extra.refEventId, payload: extra.payload || {} }).event;
  const sistema = { userId: 'sistema', name: 'Estadia BR', role: 'sistema', orgId: 'estadia-br' };

  // 3) Carga na origem, dois dias atrás: dentro do limite (R$ 0,00) e encerrada.
  const op4 = createOp({ codigo: 'OP-2026-0004', tipo: 'CARGA', destinoOrgId: o.usina.id, placa: 'QPE2H91', ...carreta('QPE2H91', 'QPF3B77'), tipoCarga: 'CARGA_GERAL', capacidadeToneladas: 30,
    pesoToneladas: 30, mercadoria: 'açúcar cristal', volume: '600 sacas', nfe: '35261000179040', cte: '35261000088015', mdfe: '35261000040772',
    localNome: 'Usina Boa Vista · Expedição', ...USINA_UBERLANDIA, responsavelNome: 'Sérgio Lima', responsavelTelefone: '+55 34 90000-0004' }, at(-3, 18, 0));
  const e4 = mk(op4);
  e4('OPERACAO_IDENTIFICADA', u.ana, [-2, 6, 40]);
  const c4 = e4('CHEGADA', u.ana, [-2, 7, 0], { payload: { gps: near(USINA_UBERLANDIA, 0.0003, 0.0002), photo } });
  e4('CHEGADA_CONFIRMADA', { userId: 'whatsapp:5534900000004', name: 'Sérgio Lima (WhatsApp)', role: 'destino', orgId: o.usina.id }, [-2, 7, 5], { refEventId: c4.id, origem: 'whatsapp' });
  const i4 = e4('INICIO', u.ana, [-2, 7, 30]);
  e4('INICIO_CONFIRMADO', u.usina, [-2, 7, 32], { refEventId: i4.id });
  const t4 = e4('TERMINO', u.ana, [-2, 9, 55]);
  e4('TERMINO_CONFIRMADO', u.usina, [-2, 10, 0], { refEventId: t4.id });
  const l4 = e4('LIBERACAO', u.usina, [-2, 10, 40], { payload: { photo: doc } });
  e4('LIBERACAO_CONFIRMADA', u.ana, [-2, 10, 42], { refEventId: l4.id });
  e4('SAIDA', u.ana, [-2, 10, 50], { payload: { photo: doc } });

  // 4) Descarga de ontem com a mesma NF-e: excedeu o limite, divergência, deslocamento e pagamento parcial.
  const op3 = createOp({ codigo: 'OP-2026-0003', tipo: 'DESCARGA', destinoOrgId: o.serra.id, placa: 'QPE2H91', ...carreta('QPE2H91', 'QPF3B77'), tipoCarga: 'CARGA_GERAL', capacidadeToneladas: 30,
    pesoToneladas: 30, mercadoria: 'açúcar cristal', volume: '600 sacas', nfe: '35261000179040', cte: '35261000088015', mdfe: '35261000040772',
    origem: 'Uberlândia/MG', localNome: 'CD Jundiaí · Doca 3', ...CD_JUNDIAI, responsavelNome: 'Marina Coelho', responsavelTelefone: '+55 11 90000-0001' }, at(-2, 12, 0));
  const e3 = mk(op3);
  e3('OPERACAO_IDENTIFICADA', u.ana, [-1, 5, 40], { origem: 'amelia' });
  const texto3 = 'Placa QPE 2H91, carreta sider, descarga de 30 toneladas de açúcar no CD Jundiaí, NF-e 35261000179040';
  const op3dados = store.forOp(op3)[0].payload;
  e3('DADOS_INFORMADOS', u.ana, [-1, 5, 40], { origem: 'amelia', payload: { canal: 'texto', texto: texto3, entidades: Amelia.comparar(Amelia.interpretar(texto3).entidades, op3dados) } });
  // Mensagens e respostas pelo WhatsApp: o motorista registra, o destino responde SIM/NÃO.
  const marinaZap = { nome: 'Marina Coelho', telefone: '5511900000001', papel: 'destino' };
  const carlaZap = { nome: 'Carla Mendes', telefone: '5511900000010', papel: 'transportadora' };
  const viaZap = (p) => ({ userId: `whatsapp:${p.telefone}`, name: `${p.nome} (WhatsApp)`, role: p.papel, orgId: p.papel === 'destino' ? o.serra.id : o.rodovia.id });
  let nMsg = 0;
  const zap = (para, t, finalidade, ref, confirmType, assunto, resposta, tResp) => {
    const mensagemId = `demo-${++nMsg}`;
    e3('WHATSAPP_ENVIADA', sistema, t, { payload: { mensagemId, para, finalidade, confirmType, refEventId: ref && ref.id, assunto, modo: 'simulado', status: 'enviada',
      texto: `*Estadia BR* · OP-2026-0003\nAna Lúcia Prado (placa QPE-2H91): ${assunto}. ${finalidade === 'CONFIRMAR' ? 'Responda SIM para confirmar ou NÃO se não reconhece.' : 'Responda OK para confirmar o recebimento.'}` } });
    e3('WHATSAPP_STATUS', sistema, [t[0], t[1], t[2] + 1], { payload: { mensagemId, status: 'entregue' } });
    if (resposta) {
      e3('WHATSAPP_STATUS', sistema, [tResp[0], tResp[1], tResp[2] - 1], { payload: { mensagemId, status: 'lida' } });
      e3('WHATSAPP_RESPOSTA', viaZap(para), tResp, { origem: 'whatsapp', payload: { mensagemId, de: para.telefone, texto: resposta, interpretacao: /^n/i.test(resposta) ? 'NAO' : 'SIM' } });
      if (confirmType && !/^n/i.test(resposta)) e3(confirmType, viaZap(para), tResp, { refEventId: ref.id, origem: 'whatsapp', payload: { mensagemId, resposta } });
    }
    return mensagemId;
  };
  const c3 = e3('CHEGADA', u.ana, [-1, 6, 12], { payload: { gps: near(CD_JUNDIAI, 0.0004, -0.0003), photo } }, [-1, 6, 14]);
  zap(marinaZap, [-1, 6, 14], 'CONFIRMAR', c3, 'CHEGADA_CONFIRMADA', 'chegou ao CD Jundiaí · Doca 3 às 06:12', 'Sim', [-1, 6, 20]);
  zap(carlaZap, [-1, 6, 14], 'INFORMAR', c3, null, 'chegou ao CD Jundiaí · Doca 3 às 06:12', 'ok', [-1, 6, 31]);
  e3('DESLOCAMENTO_FORA_DO_LIMITE', sistema, [-1, 8, 47], { payload: { distanciaM: 612, limiteM: 300, posicao: near(CD_JUNDIAI, 0.0052, 0.0021, 15), referencia: { ...CD_JUNDIAI, fonte: 'local cadastrado' } } });
  const i3 = e3('INICIO', u.ana, [-1, 10, 48], { payload: { gps: near(CD_JUNDIAI, 0.0002, 0.0001) } });
  const mi = zap(marinaZap, [-1, 10, 48], 'CONFIRMAR', i3, 'INICIO_CONFIRMADO', 'iniciou a descarga às 10:48', 'Não, começou 11:05', [-1, 10, 58]);
  e3('DIVERGENCIA', viaZap(marinaZap), [-1, 10, 58], { refEventId: i3.id, origem: 'whatsapp', payload: { note: 'Respondeu NÃO pelo WhatsApp: "Não, começou 11:05"', mensagemId: mi, alegadoEm: at(-1, 11, 5) } });
  const t3 = e3('TERMINO', u.ana, [-1, 15, 5], { payload: { photo } });
  zap(marinaZap, [-1, 15, 5], 'CONFIRMAR', t3, 'TERMINO_CONFIRMADO', 'terminou a descarga às 15:05', 'SIM', [-1, 15, 10]);
  const l3 = e3('LIBERACAO', u.ana, [-1, 17, 32], { payload: { photo: doc } });
  zap(marinaZap, [-1, 17, 32], 'CONFIRMAR', l3, 'LIBERACAO_CONFIRMADA', 'foi liberado para viagem às 17:32', 'sim', [-1, 17, 35]);
  zap(carlaZap, [-1, 17, 32], 'INFORMAR', l3, null, 'foi liberado para viagem às 17:32', 'Recebido', [-1, 17, 50]);
  const s3 = e3('SAIDA', u.ana, [-1, 17, 41], { payload: { photo: doc } });
  zap(carlaZap, [-1, 17, 42], 'INFORMAR', s3, null, 'saiu do local às 17:41. Tempo de estadia 11h12, valor devido R$ 840,00', 'ok', [-1, 18, 2]);

  const historico = gerarHistorico({ dir, store, o, u, actor, photo, doc, sistema });

  if (!quiet) console.log('Dados de demonstração criados. Senha de todos os usuários:', SENHA_DEMO);
  return { orgs: o, users: u, ops: { op3, op4 }, at, historico };
}

// ---------- Histórico de demonstração para os painéis ----------
// Viagens fictícias, determinísticas (gerador com semente fixa), desde a vigência da regra atual.
function gerarHistorico({ dir, store, o, u, actor, photo, doc, sistema }) {
  let semente = 20261001;
  const rnd = () => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const entre = (a, b) => a + rnd() * (b - a);
  const novos = {
    porto: dir.addOrg({ id: 'porto-santos', nome: 'Terminal Porto Seco · Santos', tipo: 'destino' }),
    coop: dir.addOrg({ id: 'coop-vale-verde', nome: 'Cooperativa Vale Verde · Rio Verde', tipo: 'destino' }),
  };
  dir.addUser({ email: 'gate@portoseco.demo', senha: SENHA_DEMO, nome: 'Lucas Martins', role: 'destino', orgId: novos.porto.id });
  dir.addUser({ email: 'expedicao@valeverde.demo', senha: SENHA_DEMO, nome: 'Fernanda Rocha', role: 'destino', orgId: novos.coop.id });
  const locais = [
    { org: o.serra, tipo: 'DESCARGA', local: 'CD Jundiaí · Doca 4', cidade: 'Jundiaí/SP', lat: -23.18571, lng: -46.89784 },
    { org: o.horizonte, tipo: 'DESCARGA', local: 'CD Campinas · Doca 2', cidade: 'Campinas/SP', lat: -22.90556, lng: -47.06083 },
    { org: novos.porto, tipo: 'DESCARGA', local: 'Porto Seco · Gate 3', cidade: 'Santos/SP', lat: -23.95, lng: -46.333 },
    { org: o.usina, tipo: 'CARGA', local: 'Usina Boa Vista · Expedição', cidade: 'Uberlândia/MG', lat: -18.91861, lng: -48.27722 },
    { org: novos.coop, tipo: 'CARGA', local: 'Cooperativa Vale Verde · Silo 1', cidade: 'Rio Verde/GO', lat: -17.7923, lng: -50.9192 },
  ];
  const origens = ['Ribeirão Preto/SP', 'Uberlândia/MG', 'Rio Verde/GO', 'Sorocaba/SP', 'Maringá/PR', 'Cuiabá/MT', 'Londrina/PR', 'Goiânia/GO'];
  const cargas = {
    GRANELEIRO: [['GRANEL_SOLIDO', 'soja'], ['GRANEL_SOLIDO', 'milho'], ['GRANEL_SOLIDO', 'açúcar VHP']],
    SIDER: [['CARGA_GERAL', 'açúcar cristal'], ['CARGA_GERAL', 'bebidas']],
    BAU: [['CARGA_GERAL', 'eletrodomésticos'], ['CARGA_GERAL', 'alimentos']],
    BAU_FRIGORIFICO: [['FRIGORIFICADA', 'carne bovina'], ['FRIGORIFICADA', 'frango congelado']],
    TANQUE: [['GRANEL_LIQUIDO', 'etanol']],
  };
  // Motoristas extras, cada um com o seu conjunto
  const extra = [
    ['Carlos Eduardo Souza', '11988880003', 'carlos', { composicao: 'BITREM', placaVeiculo: 'RCS3A10', placasImplementos: ['RCS3A11', 'RCS3A12'], carroceria: 'GRANELEIRO', capacidadeToneladas: 37 }],
    ['Márcio Alves', '11988880004', 'marcio', { composicao: 'RODOTREM', placaVeiculo: 'RMA5B20', placasImplementos: ['RMA5B21', 'RMA5B22'], carroceria: 'GRANELEIRO', capacidadeToneladas: 48 }],
    ['Patrícia Gomes', '11988880005', 'patricia', { composicao: 'TRUCK', placaVeiculo: 'RPG7C30', placasImplementos: [], carroceria: 'BAU_FRIGORIFICO', capacidadeToneladas: 14 }],
    ['Roberto Lima', '11988880006', 'roberto', { composicao: 'VANDERLEIA', placaVeiculo: 'RRL9D40', placasImplementos: ['RRL9D41'], carroceria: 'TANQUE', capacidadeToneladas: 33 }],
  ];
  const motoristas = [
    { user: u.joao, conj: dir.frotaDe(u.joao).conjuntos[0], demo: true },
    { user: u.ana, conj: dir.frotaDe(u.ana).conjuntos[0], demo: true },
  ];
  for (const [nome, tel, id, c] of extra) {
    const user = dir.addUser({ email: `${id}@tac.demo`, senha: SENHA_DEMO, nome, role: 'tac', orgId: o.tac.id, telefone: tel, pin: '1234' });
    motoristas.push({ user, conj: dir.salvarConjunto(C.validarConjunto(c), { orgId: o.tac.id, userId: user.id }), demo: false });
  }
  const portarias = { 'serra-azul': 'Portaria Serra Azul', horizonte: 'Portaria Horizonte', 'porto-santos': 'Gate Porto Seco', 'usina-boa-vista': 'Expedição Usina', 'coop-vale-verde': 'Balança Vale Verde' };
  const agora = Date.now();
  const inicio = Math.max(Date.parse('2026-10-01T09:00:00Z'), agora - 45 * 86400000);
  const dias = Math.max(1, Math.floor((agora - inicio) / 86400000));
  const total = Math.min(90, Math.max(24, dias * 5));
  const iso = (ms) => new Date(ms).toISOString();
  const lista = [];
  for (let i = 0; i < total; i++) {
    const emCurso = i >= total - 4; // as últimas ficam em andamento (motoristas que não são da demonstração ao vivo)
    const m = emCurso ? pick(motoristas.filter((x) => !x.demo)) : pick(motoristas);
    const carroceria = m.conj.carroceria;
    const [tipoCarga, mercadoria] = pick(cargas[carroceria] || cargas.SIDER);
    const loc = pick(locais.filter((l) => (carroceria === 'TANQUE' || carroceria === 'GRANELEIRO' ? true : l.org !== novos.coop)));
    const autonomo = rnd() < 0.2;
    let chegada = emCurso ? agora - entre(1, 8) * 3600000 : inicio + rnd() * (agora - inicio - 14 * 3600000);
    const d = new Date(chegada); const h = d.getUTCHours(); if (!emCurso && (h < 8 || h > 20)) chegada += (12 - h) * 3600000; // horário comercial (UTC-3)
    const lento = rnd() < 0.34;
    const esperaIni = lento ? entre(150, 420) : entre(15, 110);
    const duracao = entre(50, lento ? 260 : 150);
    const conf = chegada + entre(3, 28) * 60000;
    const ini = conf + esperaIni * 60000;
    const ter = ini + duracao * 60000;
    const lib = ter + entre(8, 70) * 60000;
    const sai = lib + entre(4, 25) * 60000;
    const opId = require('node:crypto').randomUUID();
    const codigo = `OP-2026-${String(1001 + i)}`;
    const criada = chegada - entre(4, 30) * 3600000;
    const peso = Math.round(m.conj.capacidadeToneladas * entre(0.85, 1) * 10) / 10;
    store.append({ opId, type: 'OPERACAO_CRIADA', actor: autonomo ? actor(m.user) : actor(u.carla), origem: autonomo ? 'app' : 'portal', occurredAt: iso(criada), receivedAt: iso(criada),
      payload: { codigo, tipo: loc.tipo, ...(autonomo ? { criadaPor: 'tac', transportadoraOrgId: null, transportadoraNome: null }
        : { transportadoraOrgId: o.rodovia.id, transportadoraNome: o.rodovia.nome, transportadoraContatoNome: 'Carla Mendes', transportadoraContatoTelefone: '+55 11 90000-0010' }),
      destinoOrgId: loc.org.id, destinoNome: loc.org.nome, placa: m.conj.placa, placasImplementos: m.conj.placasImplementos, composicao: m.conj.composicao, carroceria, conjuntoId: m.conj.id,
      implemento: C.descreverConjunto(m.conj), capacidadeToneladas: m.conj.capacidadeToneladas, pesoToneladas: peso, tipoCarga, mercadoria,
      nfe: String(35261000300000 + i * 7919), origem: loc.tipo === 'CARGA' ? loc.cidade : pick(origens.filter((c) => c !== loc.cidade)), localNome: loc.local, lat: loc.lat, lng: loc.lng,
      responsavelNome: portarias[loc.org.id], responsavelTelefone: '+55 11 90000-0001' } });
    const ev = (type, ms, by, extra = {}) => store.append({ opId, type, actor: by, origem: extra.origem || (by.role === 'tac' ? 'app' : 'link_whatsapp'), occurredAt: iso(ms), receivedAt: iso(ms), refEventId: extra.ref, payload: extra.payload || {} }).event;
    const tac = actor(m.user);
    const portaria = { userId: `link:${opId}`, name: `${portarias[loc.org.id]} (via link)`, role: 'destino', orgId: loc.org.id };
    const near = (k = 0.0003) => ({ lat: +(loc.lat + (rnd() - 0.5) * k).toFixed(6), lng: +(loc.lng + (rnd() - 0.5) * k).toFixed(6), acc: Math.round(entre(5, 20)) });
    ev('OPERACAO_IDENTIFICADA', chegada - 30 * 60000, tac, { payload: { placa: m.conj.placa, via: autonomo ? 'cadastro_tac' : 'codigo' } });
    const c = ev('CHEGADA', chegada, tac, { payload: { gps: near(), photo, photos: [photo] } });
    if (!emCurso || rnd() < 0.75) ev('CHEGADA_CONFIRMADA', conf, portaria, { ref: c.id }); else { lista.push({ opId, emCurso: true }); continue; }
    if (rnd() < 0.07) ev('DESLOCAMENTO_FORA_DO_LIMITE', ini - 30 * 60000, sistema, { origem: 'sistema', payload: { distanciaM: Math.round(entre(320, 900)), limiteM: 300, posicao: near(0.01), referencia: { lat: loc.lat, lng: loc.lng, fonte: 'local cadastrado' } } });
    if (emCurso && ini > agora) { lista.push({ opId, emCurso: true }); continue; }
    const iv = ev('INICIO', ini, tac, { payload: { gps: near() } });
    if (rnd() < 0.08) ev('DIVERGENCIA', ini + 9 * 60000, portaria, { ref: iv.id, payload: { note: 'Não confere (pelo link): início efetivo foi depois.' } });
    else ev('INICIO_CONFIRMADO', ini + entre(2, 15) * 60000, portaria, { ref: iv.id });
    if (emCurso && ter > agora) { lista.push({ opId, emCurso: true }); continue; }
    const tv = ev('TERMINO', ter, tac, { payload: { gps: near() } });
    ev('TERMINO_CONFIRMADO', ter + entre(2, 15) * 60000, portaria, { ref: tv.id });
    if (emCurso) { lista.push({ opId, emCurso: true }); continue; }
    const lv = ev('LIBERACAO', lib, tac, { payload: { photo: doc, photos: [doc] } });
    ev('LIBERACAO_CONFIRMADA', lib + entre(2, 10) * 60000, portaria, { ref: lv.id });
    ev('SAIDA', sai, tac, { payload: { photo: doc, photos: [doc] } });
    const sorte = rnd();
    lista.push({ opId, saidaEm: iso(sai + 60000), pagamento: sorte < 0.45 ? 'total' : sorte < 0.7 ? 'parcial' : 'nenhum', juridico: rnd() < 0.5, encerrar: rnd() < 0.6, autonomo, motorista: m.user });
  }
  return lista;
}

module.exports = { seed, SENHA_DEMO, PIN_DEMO, demoPhotoPng, demoDocPng };
