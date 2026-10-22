// Painel somente leitura. Espelha os tópicos e os limiares de
// main/tests/test_hw290_mqtt.c. Não assina a coleta bruta e não publica.
(function () {
  "use strict";

  const TOPICO = "tcc_felipe/hw290";
  const TOPICO_EVENTOS = TOPICO + "/eventos";
  const BROKER = "wss://broker.hivemq.com:8884/mqtt";

  const LIMIAR_ARRANCADA_G = 0.3;
  const LIMIAR_FRENAGEM_G = -0.4;
  const DURACAO_MIN_MS = 100;
  const RESFRIAMENTO_MS = 500;
  const JANELA = 120;
  const SETA_G = 1;
  const SETA_PX = 72;

  const COR = {
    grade: "#2a3140",
    texto: "#8b97a8",
    zero: "#5c6b80",
    ax: "#e6a23c",
    ay: "#6cb6ff",
    az: "#b794f6",
    frenagem: "#ef6b6b",
    ponto: "#d5deea",
  };

  const estado = {
    fase: "conectando",
    erroMqtt: "",
    ultimoResumo: 0,
    amostras: [],
    eventos: [],
    ultimoPorTipo: {},
    ultimo: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function num(valor) {
    const n = typeof valor === "number" ? valor : Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(valor, casas) {
    if (!Number.isFinite(valor)) return "—";
    return valor.toLocaleString("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  }

  function rotuloTipo(tipo) {
    if (tipo === "arrancada") return "Arrancada";
    if (tipo === "frenagem") return "Frenagem";
    return tipo;
  }

  function rotuloSentido(sentido) {
    if (sentido === "frente") return "Frente";
    if (sentido === "re") return "Ré";
    return sentido;
  }

  function idadeTexto() {
    if (!estado.ultimoResumo) return "Nenhuma amostra ainda";
    const segundos = Math.round((Date.now() - estado.ultimoResumo) / 1000);
    if (segundos < 2) return "Amostra agora";
    return "Última amostra há " + segundos + " s";
  }

  function pintarLigacao() {
    const ponto = el("ponto");
    ponto.className = "ponto";
    if (estado.fase === "conectando") {
      el("status-conexao").textContent = "Conectando";
      el("status-dados").textContent = "Abrindo o canal com o broker";
      ponto.classList.add("espera");
      return;
    }
    if (estado.fase !== "conectado") {
      el("status-conexao").textContent = "Desconectado";
      el("status-dados").textContent = estado.erroMqtt || "Tentando de novo";
      ponto.classList.add("ruim");
      return;
    }
    if (!estado.ultimoResumo) {
      el("status-conexao").textContent = "Conectado";
      el("status-dados").textContent = "Aguardando o carrinho";
      ponto.classList.add("espera");
      return;
    }
    const segundos = (Date.now() - estado.ultimoResumo) / 1000;
    if (segundos > 3) {
      el("status-conexao").textContent = "Sem amostras recentes";
      ponto.classList.add("espera");
    } else {
      el("status-conexao").textContent = "Ao vivo";
      ponto.classList.add("ok");
    }
    el("status-dados").textContent = idadeTexto();
  }

  function guardarResumo(dado) {
    const amostra = {
      ax: num(dado.ax),
      ay: num(dado.ay),
      az: num(dado.az),
      gx: num(dado.gx),
      gy: num(dado.gy),
      gz: num(dado.gz),
      temp: num(dado.temp),
      press: num(dado.press),
      mpu: num(dado.mpu_temp),
    };
    if (Object.values(amostra).some((v) => v === null)) return false;
    estado.amostras.push(amostra);
    if (estado.amostras.length > JANELA) estado.amostras.shift();
    estado.ultimo = amostra;
    estado.ultimoResumo = Date.now();
    return true;
  }

  function guardarEvento(dado) {
    const evento = {
      tipo: typeof dado.tipo === "string" ? dado.tipo : "desconhecido",
      sentido: typeof dado.sentido === "string" ? dado.sentido : "—",
      t_ms: num(dado.t_ms),
      duracao_ms: num(dado.duracao_ms),
      pico: num(dado.pico),
      v_inicio: num(dado.v_inicio),
      recebido: Date.now(),
    };
    estado.eventos.unshift(evento);
    if (estado.eventos.length > 12) estado.eventos.pop();
    if (evento.tipo === "arrancada" || evento.tipo === "frenagem") {
      estado.ultimoPorTipo[evento.tipo] = evento;
    }
    return evento;
  }

  function pulsar(no, classe) {
    const token = (no._pulso || 0) + 1;
    no._pulso = token;
    no.classList.remove("pulso", "pulso-arrancada", "pulso-frenagem");
    void no.offsetWidth;
    no.classList.add("pulso", classe);
    window.setTimeout(function () {
      if (no._pulso === token) no.classList.remove("pulso", "pulso-arrancada", "pulso-frenagem");
    }, 700);
  }

  function atualizarSeta(linha, x1, y1, x2, y2, marcador) {
    const ativo = Math.hypot(x2 - x1, y2 - y1) >= 8;
    linha.setAttribute("x1", ativo ? x1.toFixed(1) : "0");
    linha.setAttribute("y1", ativo ? y1.toFixed(1) : "0");
    linha.setAttribute("x2", ativo ? x2.toFixed(1) : "0");
    linha.setAttribute("y2", ativo ? y2.toFixed(1) : "0");
    linha.setAttribute("marker-end", ativo ? marcador : "none");
    linha.style.opacity = ativo ? "1" : "0";
  }

  // Comprimento para fora da carroceria. Abaixo de 0,04 g a seta some.
  function alcanceSeta(magnitude) {
    const limitado = Math.max(-SETA_G, Math.min(SETA_G, magnitude));
    if (Math.abs(limitado) < 0.04) return 0;
    const sinal = Math.sign(limitado);
    return sinal * (18 + (Math.abs(limitado) / SETA_G) * (SETA_PX - 18));
  }

  function desenharCarro() {
    const amostra = estado.ultimo;
    const grupo = el("carro-grupo");
    const setaAx = el("seta-ax");
    const setaAy = el("seta-ay");
    if (!amostra) {
      grupo.setAttribute("transform", "translate(140,176)");
      atualizarSeta(setaAx, 0, 0, 0, 0, "url(#ponta-ax)");
      atualizarSeta(setaAy, 0, 0, 0, 0, "url(#ponta-ay)");
      return;
    }
    // gz positivo é guinada no sentido da mão direita, anti-horário visto de cima.
    // O rotate do SVG é horário, e o ângulo só indica a taxa, com teto de 25°.
    const graus = Math.max(-25, Math.min(25, -amostra.gz / 3));
    grupo.setAttribute("transform", "translate(140,176) rotate(" + graus.toFixed(2) + ")");

    const ax = alcanceSeta(amostra.ax);
    if (ax > 0) atualizarSeta(setaAx, 0, -88, 0, -88 - ax, "url(#ponta-ax)");
    else if (ax < 0) atualizarSeta(setaAx, 0, 78, 0, 78 - ax, "url(#ponta-ax)");
    else atualizarSeta(setaAx, 0, 0, 0, 0, "url(#ponta-ax)");

    const ay = alcanceSeta(amostra.ay);
    if (ay > 0) atualizarSeta(setaAy, -56, 0, -56 - ay, 0, "url(#ponta-ay)");
    else if (ay < 0) atualizarSeta(setaAy, 56, 0, 56 - ay, 0, "url(#ponta-ay)");
    else atualizarSeta(setaAy, 0, 0, 0, 0, "url(#ponta-ay)");
  }

  function pintarNumeros() {
    const amostra = estado.ultimo;
    const campos = [
      ["val-ax", amostra && amostra.ax, 3],
      ["val-ay", amostra && amostra.ay, 3],
      ["val-az", amostra && amostra.az, 3],
      ["val-gx", amostra && amostra.gx, 2],
      ["val-gy", amostra && amostra.gy, 2],
      ["val-gz", amostra && amostra.gz, 2],
      ["val-temp", amostra && amostra.temp, 1],
      ["val-mpu", amostra && amostra.mpu, 1],
    ];
    for (const [id, valor, casas] of campos) {
      el(id).textContent = fmt(valor, casas);
    }
    el("val-press").textContent = amostra ? fmt(amostra.press / 100, 1) : "—";
    el("val-press-pa").textContent = amostra ? fmt(amostra.press, 0) + " Pa" : "hPa";
  }

  function linhaDef(rotulo, valor) {
    const dt = document.createElement("dt");
    dt.textContent = rotulo;
    const dd = document.createElement("dd");
    dd.textContent = valor;
    return [dt, dd];
  }

  function pintarCarta(tipo) {
    const carta = el("carta-" + tipo);
    const corpo = carta.querySelector(".corpo");
    corpo.replaceChildren();
    const evento = estado.ultimoPorTipo[tipo];
    if (!evento) {
      const p = document.createElement("p");
      p.className = "mudo";
      p.textContent = "Aguardando disparo.";
      corpo.append(p);
      return;
    }
    const dl = document.createElement("dl");
    dl.append(
      ...linhaDef("Sentido", rotuloSentido(evento.sentido)),
      ...linhaDef("Pico", fmt(evento.pico, 3) + " g"),
      ...linhaDef("Duração", fmt(evento.duracao_ms, 0) + " ms"),
      ...linhaDef("Velocidade inicial", fmt(evento.v_inicio, 2) + " m/s"),
      ...linhaDef("t da placa", fmt(evento.t_ms, 0) + " ms")
    );
    corpo.append(dl);
  }

  function pintarLista() {
    const lista = el("lista-eventos");
    lista.replaceChildren();
    if (estado.eventos.length === 0) {
      const item = document.createElement("li");
      item.className = "mudo";
      item.textContent = "Nenhum evento nesta aba.";
      lista.append(item);
      return;
    }
    for (const evento of estado.eventos) {
      const item = document.createElement("li");
      if (evento.tipo === "arrancada" || evento.tipo === "frenagem") {
        item.classList.add(evento.tipo);
      }
      const hora = document.createElement("time");
      hora.dateTime = new Date(evento.recebido).toISOString();
      hora.textContent = new Date(evento.recebido).toLocaleTimeString("pt-BR", { hour12: false });
      const texto = document.createElement("span");
      texto.textContent =
        rotuloTipo(evento.tipo) + " · " + rotuloSentido(evento.sentido) +
        " · pico " + fmt(evento.pico, 3) + " g · " +
        fmt(evento.duracao_ms, 0) + " ms · v₀ " + fmt(evento.v_inicio, 2) + " m/s";
      item.append(hora, texto);
      lista.append(item);
    }
  }

  function preparar(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    const pxW = Math.max(1, Math.round(largura * dpr));
    const pxH = Math.max(1, Math.round(altura * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, largura, altura };
  }

  function yDaFaixa(valor, ymin, ymax, pad, plotH) {
    return pad.t + plotH - ((valor - ymin) / (ymax - ymin)) * plotH;
  }

  function desenharTempo(canvas, series, faixa) {
    const { ctx, largura, altura } = preparar(canvas);
    ctx.clearRect(0, 0, largura, altura);
    const pad = { l: 46, r: 10, t: 12, b: 12 };
    const plotW = largura - pad.l - pad.r;
    const plotH = altura - pad.t - pad.b;
    if (plotW < 20 || plotH < 20) return;

    const todos = series.flatMap((serie) => serie.valores);
    let ymin = faixa.min;
    let ymax = faixa.max;
    let expandiu = false;
    for (const valor of todos) {
      if (valor < ymin) {
        ymin = valor;
        expandiu = true;
      }
      if (valor > ymax) {
        ymax = valor;
        expandiu = true;
      }
    }
    if (expandiu) {
      const margem = (ymax - ymin) * 0.08;
      ymin -= margem;
      ymax += margem;
    }
    if (ymax === ymin) {
      ymin -= 1;
      ymax += 1;
    }

    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const valor = ymin + ((ymax - ymin) * i) / 4;
      const y = yDaFaixa(valor, ymin, ymax, pad, plotH);
      ctx.strokeStyle = COR.grade;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(largura - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = COR.texto;
      ctx.fillText(fmt(valor, faixa.casas), pad.l - 6, y);
    }

    if (ymin < 0 && ymax > 0) {
      const y0 = yDaFaixa(0, ymin, ymax, pad, plotH);
      ctx.strokeStyle = COR.zero;
      ctx.beginPath();
      ctx.moveTo(pad.l, y0);
      ctx.lineTo(largura - pad.r, y0);
      ctx.stroke();
    }

    if (faixa.linhas) {
      ctx.setLineDash([4, 4]);
      for (const linha of faixa.linhas) {
        if (linha.y < ymin || linha.y > ymax) continue;
        const y = yDaFaixa(linha.y, ymin, ymax, pad, plotH);
        ctx.strokeStyle = linha.cor;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(largura - pad.r, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const n = series.reduce((maior, serie) => Math.max(maior, serie.valores.length), 0);
    if (n < 2) return;
    for (const serie of series) {
      ctx.strokeStyle = serie.cor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      serie.valores.forEach((valor, i) => {
        const x = pad.l + (i / (n - 1)) * plotW;
        const y = yDaFaixa(valor, ymin, ymax, pad, plotH);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  function desenharGG() {
    const canvas = el("canvas-gg");
    const { ctx, largura, altura } = preparar(canvas);
    ctx.clearRect(0, 0, largura, altura);
    const lado = Math.min(largura - 28, altura - 28);
    const cx = largura / 2;
    const cy = altura / 2;
    if (lado < 40) return;

    let alcance = 1;
    for (const amostra of estado.amostras) {
      alcance = Math.max(alcance, Math.abs(amostra.ax), Math.abs(amostra.ay));
    }
    alcance *= 1.08;
    const esc = (lado / 2) / alcance;
    const esquerda = cx - lado / 2;
    const topo = cy - lado / 2;

    ctx.strokeStyle = COR.grade;
    ctx.strokeRect(esquerda, topo, lado, lado);
    ctx.strokeStyle = COR.zero;
    ctx.beginPath();
    ctx.moveTo(esquerda, cy);
    ctx.lineTo(esquerda + lado, cy);
    ctx.moveTo(cx, topo);
    ctx.lineTo(cx, topo + lado);
    ctx.stroke();

    ctx.setLineDash([4, 4]);
    for (const linha of [
      { y: LIMIAR_ARRANCADA_G, cor: COR.ax },
      { y: LIMIAR_FRENAGEM_G, cor: COR.frenagem },
    ]) {
      const y = cy - linha.y * esc;
      ctx.strokeStyle = linha.cor;
      ctx.beginPath();
      ctx.moveTo(esquerda, y);
      ctx.lineTo(esquerda + lado, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    estado.amostras.forEach((amostra, i) => {
      const t = (i + 1) / estado.amostras.length;
      const ultimo = i === estado.amostras.length - 1;
      ctx.fillStyle = ultimo ? COR.ponto : "rgba(108, 182, 255, " + (0.15 + 0.7 * t) + ")";
      ctx.beginPath();
      ctx.arc(cx - amostra.ay * esc, cy - amostra.ax * esc, ultimo ? 4.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function coluna(chave) {
    return estado.amostras.map((amostra) => amostra[chave]);
  }

  function desenharGraficos() {
    const temAmostra = estado.amostras.length > 0;
    for (const id of ["vazio-acel", "vazio-giro", "vazio-gg"]) {
      el(id).hidden = temAmostra;
    }
    desenharTempo(el("canvas-acel"), [
      { cor: COR.ax, valores: coluna("ax") },
      { cor: COR.ay, valores: coluna("ay") },
      { cor: COR.az, valores: coluna("az") },
    ], {
      min: -1,
      max: 1,
      casas: 1,
      linhas: [
        { y: LIMIAR_ARRANCADA_G, cor: COR.ax },
        { y: LIMIAR_FRENAGEM_G, cor: COR.frenagem },
      ],
    });
    desenharTempo(el("canvas-giro"), [
      { cor: COR.ax, valores: coluna("gx") },
      { cor: COR.ay, valores: coluna("gy") },
      { cor: COR.az, valores: coluna("gz") },
    ], { min: -50, max: 50, casas: 0 });
    desenharGG();
  }

  function pintarTudo() {
    desenharCarro();
    pintarNumeros();
    pintarCarta("arrancada");
    pintarCarta("frenagem");
    pintarLista();
    desenharGraficos();
    pintarLigacao();
  }

  function aoJson(texto) {
    try {
      return JSON.parse(texto);
    } catch (erro) {
      return null;
    }
  }

  function aoMensagem(topico, carga) {
    const dado = aoJson(carga.toString());
    if (!dado || typeof dado !== "object") return;
    if (topico === TOPICO_EVENTOS) {
      const evento = guardarEvento(dado);
      pintarTudo();
      const classe = evento.tipo === "frenagem" ? "pulso-frenagem" : "pulso-arrancada";
      pulsar(el("carro"), classe);
      const carta = el("carta-" + evento.tipo);
      if (carta) pulsar(carta, classe);
      return;
    }
    if (topico === TOPICO && guardarResumo(dado)) pintarTudo();
  }

  function conectar() {
    if (typeof mqtt === "undefined") {
      estado.erroMqtt = "O cliente MQTT não carregou";
      pintarLigacao();
      return;
    }
    const cliente = mqtt.connect(BROKER, {
      clientId: "tcc_painel_" + Math.random().toString(16).slice(2, 10),
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      keepalive: 30,
    });
    cliente.on("connect", function () {
      estado.fase = "conectado";
      estado.erroMqtt = "";
      cliente.subscribe(TOPICO);
      cliente.subscribe(TOPICO_EVENTOS);
      pintarLigacao();
    });
    cliente.on("message", aoMensagem);
    cliente.on("close", function () {
      if (estado.fase === "conectado") {
        estado.fase = "desconectado";
        pintarLigacao();
      }
    });
    cliente.on("error", function (erro) {
      estado.fase = "desconectado";
      const bruto = erro && erro.message ? erro.message : "";
      estado.erroMqtt = /timeout|connack|ECONN|ENOTFOUND/i.test(bruto)
        ? "Sem resposta do broker na porta 8884"
        : (bruto || "Falha na conexão");
      pintarLigacao();
    });
  }

  el("nota-topicos").textContent = TOPICO + " e " + TOPICO_EVENTOS;
  el("nota-carro").textContent =
    "A seta âmbar segue ax (frente quando positivo) e a azul segue ay (esquerda quando positivo). " +
    "O giro do desenho acompanha a taxa gz e não é a proa.";
  el("nota-eventos").textContent =
    "O cartão atualiza quando a placa publica o evento terminado. Limiares do firmware: " +
    fmt(LIMIAR_ARRANCADA_G, 2) + " g e " + fmt(LIMIAR_FRENAGEM_G, 2) +
    " g, mínimo de " + DURACAO_MIN_MS + " ms, resfriamento de " + RESFRIAMENTO_MS + " ms.";

  pintarTudo();
  conectar();
  setInterval(pintarLigacao, 1000);
  window.addEventListener("resize", desenharGraficos);
})();
