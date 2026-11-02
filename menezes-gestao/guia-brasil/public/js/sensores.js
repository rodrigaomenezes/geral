// Sensores do aparelho: GPS (ou simulação de caminhada) e bússola. Tudo opcional: sem permissão, o app segue
// funcionando com a lista de pontos e a conversa.

/** Acompanha a posição real. `aoMudar({lat,lng,precisao})`, `aoErro(msg)`. Devolve função para parar. */
export function acompanharGps(aoMudar, aoErro) {
  if (!('geolocation' in navigator)) { aoErro('Este aparelho não informa a localização.'); return () => {}; }
  const id = navigator.geolocation.watchPosition(
    (p) => aoMudar({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
    (e) => aoErro(e.code === 1 ? 'Permissão de localização negada.' : 'Não foi possível obter a localização.'),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Simulação: caminha em linha reta até o próximo ponto da rota de demonstração, em passos de ~1 s.
 * Devolve { avancar(), parar(), posicao() }.
 */
export function simularCaminhada(pacote, aoMudar) {
  const rota = (pacote.rotaDemonstracao || pacote.pois.map((p) => p.id)).map((id) => pacote.pois.find((p) => p.id === id)).filter(Boolean);
  let indice = -1;
  // Começa ~150 m ao sul do primeiro ponto, fora do raio de todos: a primeira narração é a do primeiro ponto da rota.
  let atual = rota.length ? { lat: rota[0].lat - 0.00135, lng: rota[0].lng, precisao: 5 } : { lat: pacote.centro.lat, lng: pacote.centro.lng, precisao: 5 };
  let timer = null;
  const emitir = () => aoMudar({ ...atual, simulada: true });
  const parar = () => { clearInterval(timer); timer = null; };
  function avancar() {
    parar();
    indice = (indice + 1) % rota.length;
    const alvo = rota[indice];
    // Para ~12 m antes do ponto, do lado de onde vem: dentro do raio, como uma pessoa chegando.
    const passos = 6;
    const inicio = { ...atual };
    let n = 0;
    timer = setInterval(() => {
      n += 1;
      const f = Math.min(1, n / passos) * 0.97;
      atual = { lat: inicio.lat + (alvo.lat - inicio.lat) * f, lng: inicio.lng + (alvo.lng - inicio.lng) * f, precisao: 5 };
      emitir();
      if (n >= passos) parar();
    }, 700);
    return alvo;
  }
  emitir();
  return { avancar, parar, posicao: () => ({ ...atual, simulada: true }), proximo: () => rota[(indice + 1) % rota.length] };
}

/**
 * Bússola. Em iOS a permissão só pode ser pedida num toque do usuário: chame `pedirPermissao()` dentro de um clique.
 * `direcao()` devolve graus (0 = norte) ou null.
 */
export function criarBussola() {
  let graus = null;
  let ligada = false;
  const ouvir = (e) => {
    if (Number.isFinite(e.webkitCompassHeading)) graus = e.webkitCompassHeading; // iOS
    else if (e.absolute && Number.isFinite(e.alpha)) graus = (360 - e.alpha) % 360; // Android
  };
  function ligar() {
    if (ligada) return;
    ligada = true;
    window.addEventListener('deviceorientationabsolute', ouvir, true);
    window.addEventListener('deviceorientation', ouvir, true);
  }
  async function pedirPermissao() {
    try {
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') {
        if ((await D.requestPermission()) !== 'granted') return false;
      }
      ligar();
      return true;
    } catch { return false; }
  }
  return { pedirPermissao, ligar, direcao: () => graus };
}
