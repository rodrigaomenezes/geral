'use strict';
// Dados iniciais de demonstração do Estadia BR (todos fictícios).

const crypto = require('node:crypto');
const Amelia = require('./amelia');
const zlib = require('node:zlib');

const SENHA_DEMO = 'estadia123';
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
    joao: dir.addUser({ email: 'joao@tac.demo', senha: SENHA_DEMO, nome: 'João Batista Ferreira', role: 'tac', orgId: o.tac.id, placa: 'RTB4F27' }),
    ana: dir.addUser({ email: 'ana@tac.demo', senha: SENHA_DEMO, nome: 'Ana Lúcia Prado', role: 'tac', orgId: o.tac.id, placa: 'QPE2H91' }),
    adv: dir.addUser({ email: 'juridico@andradeprado.demo', senha: SENHA_DEMO, nome: 'Dra. Helena Andrade', role: 'advocacia', orgId: o.adv.id }),
  };
  const actor = (x) => ({ userId: x.id, name: x.nome, role: x.role, orgId: x.orgId });
  const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d; };
  const at = (offset, hh, mm) => { const d = day(offset); d.setUTCHours(hh + 3, mm, 0, 0); return d.toISOString(); }; // horário de Brasília
  const createOp = (payload, when) => {
    const opId = crypto.randomUUID();
    const dest = dir.org(payload.destinoOrgId);
    store.append({ opId, type: 'OPERACAO_CRIADA', actor: actor(u.carla), origem: 'portal', occurredAt: when, receivedAt: when,
      payload: { transportadoraOrgId: o.rodovia.id, transportadoraNome: o.rodovia.nome, destinoNome: dest.nome, ...payload } });
    return opId;
  };
  const todayStart = at(0, 5, 0) < new Date().toISOString() ? at(0, 5, 0) : new Date().toISOString();

  // 1) Operação pronta para a demonstração ao vivo.
  createOp({ codigo: 'OP-2026-0001', tipo: 'DESCARGA', destinoOrgId: o.serra.id, placa: 'RTB4F27', implemento: 'carreta sider', capacidadeToneladas: 30,
    pesoToneladas: 28, mercadoria: 'açúcar cristal', volume: '560 sacas', nfe: '35261000184552', cte: '35261000099871', mdfe: '35261000044120',
    origem: 'Ribeirão Preto/SP', localNome: 'CD Jundiaí · Doca 7', ...CD_JUNDIAI, dataPrevista: at(0, 9, 0),
    responsavelNome: 'Marina Coelho', responsavelTelefone: '+55 11 90000-0001' }, todayStart);

  // 2) Operação de outro destino (isolamento entre organizações).
  createOp({ codigo: 'OP-2026-0002', tipo: 'DESCARGA', destinoOrgId: o.horizonte.id, placa: 'QPE2H91', implemento: 'baú', capacidadeToneladas: 24,
    pesoToneladas: 22, mercadoria: 'bebidas', nfe: '35261000201118', origem: 'Sorocaba/SP', localNome: 'CD Campinas · Doca 2', lat: -22.90556, lng: -47.06083,
    responsavelNome: 'Paulo Reis', responsavelTelefone: '+55 19 90000-0002' }, todayStart);

  const photo = store.savePhoto(demoPhotoPng(), 'image/png');
  const doc = store.savePhoto(demoDocPng(), 'image/png');
  const near = (base, dLat, dLng, acc = 8) => ({ lat: +(base.lat + dLat).toFixed(6), lng: +(base.lng + dLng).toFixed(6), acc });
  const mk = (opId) => (type, by, t, extra = {}, recv) => store.append({ opId, type, actor: by.id ? actor(by) : by, origem: extra.origem || (by.role === 'tac' ? 'app' : 'portal'),
    occurredAt: at(...t), receivedAt: recv ? at(...recv) : at(...t), refEventId: extra.refEventId, payload: extra.payload || {} }).event;
  const sistema = { userId: 'sistema', name: 'Estadia BR', role: 'sistema', orgId: 'estadia-br' };
  const viaLink = (nome) => ({ userId: 'link', name: `${nome} (via link)`, role: 'destino', orgId: o.serra.id });

  // 3) Carga na origem, dois dias atrás: dentro do limite (R$ 0,00) e encerrada.
  const op4 = createOp({ codigo: 'OP-2026-0004', tipo: 'CARGA', destinoOrgId: o.usina.id, placa: 'QPE2H91', implemento: 'carreta sider', capacidadeToneladas: 30,
    pesoToneladas: 30, mercadoria: 'açúcar cristal', volume: '600 sacas', nfe: '35261000179040', cte: '35261000088015', mdfe: '35261000040772',
    localNome: 'Usina Boa Vista · Expedição', ...USINA_UBERLANDIA, responsavelNome: 'Sérgio Lima', responsavelTelefone: '+55 34 90000-0004' }, at(-3, 18, 0));
  const e4 = mk(op4);
  e4('OPERACAO_IDENTIFICADA', u.ana, [-2, 6, 40]);
  const c4 = e4('CHEGADA', u.ana, [-2, 7, 0], { payload: { gps: near(USINA_UBERLANDIA, 0.0003, 0.0002), photo } });
  e4('CHEGADA_CONFIRMADA', viaLink('Sérgio Lima'), [-2, 7, 5], { refEventId: c4.id, origem: 'link_whatsapp' });
  const i4 = e4('INICIO', u.ana, [-2, 7, 30]);
  e4('INICIO_CONFIRMADO', u.usina, [-2, 7, 32], { refEventId: i4.id });
  const t4 = e4('TERMINO', u.ana, [-2, 9, 55]);
  e4('TERMINO_CONFIRMADO', u.usina, [-2, 10, 0], { refEventId: t4.id });
  const l4 = e4('LIBERACAO', u.usina, [-2, 10, 40], { payload: { photo: doc } });
  e4('LIBERACAO_CONFIRMADA', u.ana, [-2, 10, 42], { refEventId: l4.id });
  e4('SAIDA', u.ana, [-2, 10, 50], { payload: { photo: doc, gps: { erro: 'Não exigido na saída' } } });

  // 4) Descarga de ontem com a mesma NF-e: excedeu o limite, divergência, deslocamento e pagamento parcial.
  const op3 = createOp({ codigo: 'OP-2026-0003', tipo: 'DESCARGA', destinoOrgId: o.serra.id, placa: 'QPE2H91', implemento: 'carreta sider', capacidadeToneladas: 30,
    pesoToneladas: 30, mercadoria: 'açúcar cristal', volume: '600 sacas', nfe: '35261000179040', cte: '35261000088015', mdfe: '35261000040772',
    origem: 'Uberlândia/MG', localNome: 'CD Jundiaí · Doca 3', ...CD_JUNDIAI, responsavelNome: 'Marina Coelho', responsavelTelefone: '+55 11 90000-0001' }, at(-2, 12, 0));
  const e3 = mk(op3);
  e3('OPERACAO_IDENTIFICADA', u.ana, [-1, 5, 40], { origem: 'amelia' });
  const texto3 = 'Placa QPE 2H91, carreta sider, descarga de 30 toneladas de açúcar no CD Jundiaí, NF-e 35261000179040';
  const op3dados = store.forOp(op3)[0].payload;
  e3('DADOS_INFORMADOS', u.ana, [-1, 5, 40], { origem: 'amelia', payload: { canal: 'texto', texto: texto3, entidades: Amelia.comparar(Amelia.interpretar(texto3).entidades, op3dados) } });
  const c3 = e3('CHEGADA', u.ana, [-1, 6, 12], { payload: { gps: near(CD_JUNDIAI, 0.0004, -0.0003), photo } }, [-1, 6, 14]);
  e3('LINK_GERADO', sistema, [-1, 6, 14], { payload: { linkId: 'demo-op3', refEventId: c3.id, confirmType: 'CHEGADA_CONFIRMADA', canal: 'whatsapp', modo: 'manual',
    destinatario: { nome: 'Marina Coelho', telefone: '+55 11 90000-0001' }, expiraEm: at(0, 6, 14), tokenHash: 'demo' } });
  e3('LINK_ENVIADO', u.ana, [-1, 6, 15], { payload: { linkId: 'demo-op3', canal: 'whatsapp', modo: 'manual' } });
  e3('LINK_VISUALIZADO', viaLink('Marina Coelho'), [-1, 6, 18], { origem: 'link_whatsapp', payload: { linkId: 'demo-op3' } });
  e3('CHEGADA_CONFIRMADA', viaLink('Marina Coelho'), [-1, 6, 20], { refEventId: c3.id, origem: 'link_whatsapp', payload: { linkId: 'demo-op3' } });
  e3('DESLOCAMENTO_FORA_DO_LIMITE', sistema, [-1, 8, 47], { payload: { distanciaM: 612, limiteM: 300, posicao: near(CD_JUNDIAI, 0.0052, 0.0021, 15), referencia: { ...CD_JUNDIAI, fonte: 'local cadastrado' } } });
  const i3 = e3('INICIO', u.ana, [-1, 10, 48], { payload: { gps: near(CD_JUNDIAI, 0.0002, 0.0001) } });
  e3('DIVERGENCIA', u.rafael, [-1, 10, 58], { refEventId: i3.id, payload: { note: 'Início efetivo na doca às 11:05, conforme apontamento da equipe.', alegadoEm: at(-1, 11, 5) } });
  const t3 = e3('TERMINO', u.ana, [-1, 15, 5], { payload: { photo } });
  e3('TERMINO_CONFIRMADO', u.rafael, [-1, 15, 10], { refEventId: t3.id });
  const l3 = e3('LIBERACAO', u.marina, [-1, 17, 32], { payload: { photo: doc } });
  e3('LIBERACAO_CONFIRMADA', u.ana, [-1, 17, 35], { refEventId: l3.id });
  e3('SAIDA', u.ana, [-1, 17, 41], { payload: { photo: doc, gps: { erro: 'Não exigido na saída' } } });

  if (!quiet) console.log('Dados de demonstração criados. Senha de todos os usuários:', SENHA_DEMO);
  return { orgs: o, users: u, ops: { op3, op4 }, at };
}

module.exports = { seed, SENHA_DEMO, demoPhotoPng, demoDocPng };
