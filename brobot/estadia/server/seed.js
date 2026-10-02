'use strict';
// Dados iniciais de demonstração: organizações, usuários e operações (fictícios).

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SENHA_DEMO = 'estadia123';
const CD_JUNDIAI = { lat: -23.18571, lng: -46.89784 };

// Gera um PNG simples (caminhão no pátio) sem dependências, para a evidência da operação histórica.
function demoPhotoPng(w = 320, h = 200) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, [r, g, b]) => { const i = (y * w + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  rect(0, 0, w, 150, [201, 216, 230]);
  rect(0, 150, w, h, [93, 102, 112]);
  for (let x = 0; x < w; x += 34) rect(x, 168, x + 20, 172, [232, 225, 200]);
  rect(18, 60, 28, 152, [42, 47, 53]);
  for (let x = 28; x < 148; x += 24) { rect(x, 72, x + 12, 80, [242, 169, 0]); rect(x + 12, 72, x + 24, 80, [26, 26, 26]); }
  rect(150, 70, 278, 142, [230, 233, 236]);
  rect(278, 92, 312, 142, [47, 109, 179]);
  rect(286, 98, 306, 114, [188, 211, 234]);
  const wheel = (cx) => { for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) if (x * x + y * y <= 100) set(cx + x, 148 + y, [29, 33, 38]); };
  [176, 200, 296].forEach(wheel);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
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

function seed(dir, store, { quiet = false } = {}) {
  const orgs = {
    brobot: dir.addOrg({ id: 'brobot', nome: 'Brobot Tecnologia', tipo: 'plataforma' }),
    serra: dir.addOrg({ id: 'serra-azul', nome: 'Atacadista Serra Azul · CD Jundiaí', tipo: 'destino' }),
    horizonte: dir.addOrg({ id: 'horizonte', nome: 'Mercado Horizonte · CD Campinas', tipo: 'destino' }),
    adv: dir.addOrg({ id: 'andrade-prado', nome: 'Andrade & Prado Advogados', tipo: 'advocacia' }),
    tac: dir.addOrg({ id: 'tac-autonomos', nome: 'Transportadores autônomos', tipo: 'tac' }),
  };
  const u = {
    admin: dir.addUser({ email: 'admin@brobot.demo', senha: SENHA_DEMO, nome: 'Administrador Brobot', role: 'admin', orgId: orgs.brobot.id }),
    marina: dir.addUser({ email: 'portaria@serraazul.demo', senha: SENHA_DEMO, nome: 'Marina Coelho', role: 'destino', orgId: orgs.serra.id }),
    rafael: dir.addUser({ email: 'doca@serraazul.demo', senha: SENHA_DEMO, nome: 'Rafael Toledo', role: 'destino', orgId: orgs.serra.id }),
    paulo: dir.addUser({ email: 'cd@horizonte.demo', senha: SENHA_DEMO, nome: 'Paulo Reis', role: 'destino', orgId: orgs.horizonte.id }),
    joao: dir.addUser({ email: 'joao@tac.demo', senha: SENHA_DEMO, nome: 'João Batista Ferreira', role: 'tac', orgId: orgs.tac.id, placa: 'RTB4F27' }),
    ana: dir.addUser({ email: 'ana@tac.demo', senha: SENHA_DEMO, nome: 'Ana Lúcia Prado', role: 'tac', orgId: orgs.tac.id, placa: 'QPE2H91' }),
    adv: dir.addUser({ email: 'juridico@andradeprado.demo', senha: SENHA_DEMO, nome: 'Dra. Helena Andrade', role: 'advocacia', orgId: orgs.adv.id }),
  };
  const actor = (user) => ({ userId: user.id, name: user.nome, role: user.role, orgId: user.orgId });
  const createOp = (by, payload, when) => {
    const opId = crypto.randomUUID();
    store.append({ opId, type: 'OPERACAO_CRIADA', actor: actor(by), occurredAt: when, receivedAt: when, payload: { destinoOrgId: by.orgId, destinoNome: dir.org(by.orgId).nome, ...payload } });
    return opId;
  };

  // 1) Operação pronta para a demonstração ao vivo (João ainda não identificou).
  createOp(u.marina, { codigo: 'OP-2026-0001', placa: 'RTB4F27', cargaToneladas: 28, nf: 'NF-e 35261.000.184.552', origem: 'Ribeirão Preto/SP', localNome: 'CD Jundiaí · Doca 7', ...CD_JUNDIAI, raioM: 300 });

  // 2) Operação de outra organização (isolamento: Serra Azul não enxerga).
  createOp(u.paulo, { codigo: 'OP-2026-0002', placa: 'QPE2H91', cargaToneladas: 22, nf: 'NF-e 35261.000.201.118', origem: 'Sorocaba/SP', localNome: 'CD Campinas · Doca 2', lat: -22.90556, lng: -47.06083, raioM: 300 });

  // 3) Operação histórica completa, com divergência e excedente, para mostrar apuração e dossiê.
  const day = new Date(); day.setUTCDate(day.getUTCDate() - 1);
  const at = (hh, mm) => { const d = new Date(day); d.setUTCHours(hh + 3, mm, 0, 0); return d.toISOString(); }; // horário de Brasília
  const opId = createOp(u.marina, { codigo: 'OP-2026-0003', placa: 'QPE2H91', cargaToneladas: 30, nf: 'NF-e 35261.000.179.040', origem: 'Uberlândia/MG', localNome: 'CD Jundiaí · Doca 3', ...CD_JUNDIAI, raioM: 300 }, at(5, 0));
  const near = (dLat, dLng, acc = 8) => ({ lat: CD_JUNDIAI.lat + dLat, lng: CD_JUNDIAI.lng + dLng, acc });
  const photo = store.savePhoto(demoPhotoPng(), 'image/png');
  const ev = (type, by, t, extra = {}, recv) => store.append({ opId, type, actor: actor(by), occurredAt: at(...t), receivedAt: recv ? at(...recv) : at(...t), ...extra }).event;
  ev('OPERACAO_IDENTIFICADA', u.ana, [5, 40]);
  const cheg = ev('CHEGADA', u.ana, [6, 12], { payload: { gps: near(0.0004, -0.0003), photo } }, [6, 41]);
  ev('DIVERGENCIA', u.marina, [6, 50], { refEventId: cheg.id, payload: { note: 'Veículo não localizado na portaria às 06:12. Entrada registrada na cancela às 06:31.', alegadoEm: at(6, 31) } });
  ev('CHEGADA_CONFIRMADA', u.marina, [6, 51], { refEventId: cheg.id, payload: { note: 'Confirmada com ressalva (ver divergência).' } });
  const ini = ev('INICIO', u.ana, [10, 48], { payload: { gps: near(0.0002, 0.0001) } });
  ev('INICIO_CONFIRMADO', u.rafael, [10, 52], { refEventId: ini.id });
  const ter = ev('TERMINO', u.ana, [15, 5]);
  ev('TERMINO_CONFIRMADO', u.rafael, [15, 10], { refEventId: ter.id });
  const lib = ev('LIBERACAO', u.marina, [17, 32]);
  ev('LIBERACAO_CIENCIA', u.ana, [17, 35], { refEventId: lib.id });
  ev('SAIDA', u.ana, [17, 41], { payload: { gps: near(0.0011, 0.0009, 12) } });

  if (!quiet) {
    console.log('Dados de demonstração criados. Senha de todos os usuários:', SENHA_DEMO);
  }
  return { orgs, users: u };
}

module.exports = { seed, SENHA_DEMO, demoPhotoPng };
