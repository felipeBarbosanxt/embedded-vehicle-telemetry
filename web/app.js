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
    if (tipo === "curva") return "Curva";
    if (tipo === "impacto") return "Impacto";
    if (!tipo) return "Evento";
    return tipo.charAt(0).toUpperCase() + tipo.slice(1);
  }

  function rotuloSentido(sentido) {
    if (sentido === "frente") return "Frente";
    if (sentido === "re") return "Ré";
    if (sentido === "esquerda") return "Esquerda";
    if (sentido === "direita") return "Direita";
    if (sentido === "cima") return "Cima";
    if (sentido === "baixo") return "Baixo";
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
    if (estado.fase === "simulacao") {
      el("status-conexao").textContent = "Simulação";
      el("status-dados").textContent = "Modelo local. Nada é publicado.";
      ponto.classList.add("ok");
      return;
    }
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
    const amostra = estado.pose || estado.ultimo;
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
      if (evento.tipo === "arrancada" || evento.tipo === "frenagem" ||
          evento.tipo === "curva" || evento.tipo === "impacto") {
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
    for (const linha of linhasLimiar()) {
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
      linhas: linhasLimiar(),
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

  function receber(topico, dado) {
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

  function aoMensagem(topico, carga) {
    receber(topico, aoJson(carga.toString()));
  }

  let clienteMqtt = null;
  let simulando = false;

  function conectar() {
    if (simulando) return;
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
    clienteMqtt = cliente;
    cliente.on("connect", function () {
      if (simulando) return;
      estado.fase = "conectado";
      estado.erroMqtt = "";
      cliente.subscribe(TOPICO);
      cliente.subscribe(TOPICO_EVENTOS);
      pintarLigacao();
    });
    cliente.on("message", aoMensagem);
    cliente.on("close", function () {
      if (simulando || estado.fase !== "conectado") return;
      estado.fase = "desconectado";
      pintarLigacao();
    });
    cliente.on("error", function (erro) {
      if (simulando) return;
      estado.fase = "desconectado";
      const bruto = erro && erro.message ? erro.message : "";
      estado.erroMqtt = /timeout|connack|ECONN|ENOTFOUND/i.test(bruto)
        ? "Sem resposta do broker na porta 8884"
        : (bruto || "Falha na conexão");
      pintarLigacao();
    });
  }

  // Mesma máquina de detector_atualizar, no passo de 20 ms. O resumo sai a cada 500 ms.
  const PASSO_MS = 20;
  const HISTERESE = 0.7;
  const VELOCIDADE_MIN = 0.05;
  const PARADO_ACC_G = 0.03;
  const PARADO_GYRO_DPS = 3;
  const PARADO_MS = 200;
  const GRAVIDADE = 9.81;
  const PISTA_W = 6;
  const PISTA_H = 4;
  const OCIOSO = "ocioso";
  const CANDIDATO = "candidato";
  const ATIVO = "ativo";
  const RESFRIAMENTO = "resfriamento";

  const sim = {
    tMs: 0,
    v: 0,
    proa: 0,
    x: 0,
    y: 0,
    paradoMs: 0,
    acumulado: 0,
    ultimoQuadro: 0,
    proximoResumo: 0,
    quadroId: 0,
    manobra: null,
    teclas: new Set(),
    trilha: [],
    soma: { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, n: 0 },
    textoMaquina: "",
  };

  function detectorNovo() {
    return { estado: OCIOSO, tInicio: 0, tFim: 0, pico: 0, vInicio: 0 };
  }

  let proximoId = 1;
  function itemCatalogo(parcial) {
    proximoId += 1;
    const item = {
      id: String(proximoId),
      nome: parcial.nome,
      eixo: parcial.eixo,
      limiar: parcial.limiar,
      minMs: parcial.minMs || DURACAO_MIN_MS,
      resfriamentoMs: parcial.resfriamentoMs || RESFRIAMENTO_MS,
      ativo: parcial.ativo !== false,
      origem: parcial.origem || "ensaio",
      det: detectorNovo(),
    };
    return item;
  }

  const catalogo = [
    itemCatalogo({ nome: "Arrancada", eixo: "ax", limiar: LIMIAR_ARRANCADA_G, origem: "firmware" }),
    itemCatalogo({ nome: "Frenagem", eixo: "ax", limiar: LIMIAR_FRENAGEM_G, origem: "firmware" }),
    itemCatalogo({ nome: "Curva", eixo: "ay", limiar: 0.4, origem: "ensaio" }),
    itemCatalogo({ nome: "Curva", eixo: "ay", limiar: -0.4, origem: "ensaio" }),
    itemCatalogo({ nome: "Impacto", eixo: "az", limiar: 1, origem: "ensaio" }),
  ];

  function linhasLimiar() {
    const linhas = [];
    for (const item of catalogo) {
      if (!item.ativo || item.origem !== "firmware" || item.eixo !== "ax") continue;
      linhas.push({ y: item.limiar, cor: item.limiar < 0 ? COR.frenagem : COR.ax });
    }
    return linhas;
  }

  function slugTipo(nome) {
    const base = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return slug || "evento";
  }

  function sentidoDoEixo(eixo, limiar) {
    const positivo = limiar > 0;
    if (eixo === "ax") return positivo ? "frente" : "re";
    if (eixo === "ay" || eixo === "gz") return positivo ? "esquerda" : "direita";
    if (eixo === "az") return positivo ? "cima" : "baixo";
    return positivo ? "positivo" : "negativo";
  }

  function zerarDetector(det) {
    det.estado = OCIOSO;
    det.tInicio = 0;
    det.tFim = 0;
    det.pico = 0;
    det.vInicio = 0;
  }

  function detectorAtualizar(cfg, det, valor, velocidade, tMs) {
    const v = cfg.limiar < 0 ? -valor : valor;
    const limiar = Math.abs(cfg.limiar);
    switch (det.estado) {
    case OCIOSO:
      if (v > limiar) {
        det.estado = CANDIDATO;
        det.tInicio = tMs;
        det.pico = v;
        det.vInicio = velocidade;
      }
      break;
    case CANDIDATO:
      det.pico = Math.max(det.pico, v);
      if (v < limiar * HISTERESE) det.estado = OCIOSO;
      else if (tMs - det.tInicio >= cfg.minMs) det.estado = ATIVO;
      break;
    case ATIVO:
      det.pico = Math.max(det.pico, v);
      if (v < limiar * HISTERESE) {
        det.estado = RESFRIAMENTO;
        det.tFim = tMs;
        return true;
      }
      break;
    case RESFRIAMENTO:
      if (tMs - det.tFim >= cfg.resfriamentoMs) det.estado = OCIOSO;
      break;
    }
    return false;
  }

  function emitirEixo(cfg, det) {
    const positivo = cfg.limiar > 0;
    const v0 = det.vInicio;
    const frenagem = positivo ? v0 < -VELOCIDADE_MIN : v0 > VELOCIDADE_MIN;
    const frente = frenagem ? v0 > 0 : positivo;
    const pico = positivo ? det.pico : -det.pico;
    receber(TOPICO_EVENTOS, {
      tipo: frenagem ? "frenagem" : "arrancada",
      sentido: frente ? "frente" : "re",
      t_ms: Math.round(det.tInicio),
      duracao_ms: Math.round(det.tFim - det.tInicio),
      pico: Math.round(pico * 1000) / 1000,
      v_inicio: Math.round(v0 * 100) / 100,
    });
  }

  function emitirEnsaio(tipo, sentido, det, sinal) {
    receber(TOPICO_EVENTOS, {
      tipo: tipo,
      sentido: sentido,
      t_ms: Math.round(det.tInicio),
      duracao_ms: Math.round(det.tFim - det.tInicio),
      pico: Math.round((sinal * det.pico) * 1000) / 1000,
      v_inicio: Math.round(det.vInicio * 100) / 100,
    });
  }

  function rotuloEstado(det) {
    if (det.estado === CANDIDATO) return "candidato";
    if (det.estado === ATIVO) return "ativo";
    if (det.estado === RESFRIAMENTO) return "resfriamento";
    return "ocioso";
  }

  function pintarMaquina() {
    const partes = [];
    for (const item of catalogo) {
      const marca = item.origem === "ensaio" ? " (ensaio)" : "";
      partes.push(item.nome + marca + ": " + rotuloEstado(item.det));
      const selo = document.querySelector('.estado-det[data-id="' + item.id + '"]');
      if (selo) selo.textContent = rotuloEstado(item.det);
    }
    const texto = partes.join(" · ");
    if (texto === sim.textoMaquina) return;
    sim.textoMaquina = texto;
    const linha = el("sim-maquina");
    if (linha) linha.textContent = texto;
  }

  function enrolar(valor, tamanho) {
    const meio = tamanho / 2;
    return ((valor + meio) % tamanho + tamanho) % tamanho - meio;
  }

  function comandos() {
    const agora = performance.now();
    if (sim.manobra && agora < sim.manobra.ate) return sim.manobra;
    sim.manobra = null;
    let frente = 0;
    let lado = 0;
    if (sim.teclas.has("KeyW") || sim.teclas.has("ArrowUp")) frente += 1;
    if (sim.teclas.has("KeyS") || sim.teclas.has("ArrowDown")) frente -= 1;
    if (sim.teclas.has("KeyA") || sim.teclas.has("ArrowLeft")) lado += 1;
    if (sim.teclas.has("KeyD") || sim.teclas.has("ArrowRight")) lado -= 1;
    let ax = 0;
    if (frente > 0) ax = 0.55;
    else if (frente < 0) ax = -0.6;
    else if (Math.abs(sim.v) > VELOCIDADE_MIN) ax = -Math.sign(sim.v) * 0.08;
    const gz = lado * 45;
    const ay = lado !== 0 && Math.abs(sim.v) > 0.2 ? lado * 0.5 : 0;
    return { ax: ax, ay: ay, az: 0, gz: gz };
  }

  function passo() {
    sim.tMs += PASSO_MS;
    const dt = PASSO_MS / 1000;
    const cmd = comandos();
    const ax = cmd.ax;
    const ay = cmd.ay;
    const az = cmd.az;
    const gz = cmd.gz;
    sim.v += ax * GRAVIDADE * dt;
    const parado = Math.abs(ax) <= PARADO_ACC_G && Math.abs(ay) <= PARADO_ACC_G &&
      Math.abs(az) <= PARADO_ACC_G && Math.abs(gz) <= PARADO_GYRO_DPS;
    sim.paradoMs = parado ? sim.paradoMs + PASSO_MS : 0;
    if (sim.paradoMs >= PARADO_MS) sim.v = 0;

    const w = gz * Math.PI / 180;
    sim.proa += w * dt;
    const nx = sim.x - Math.sin(sim.proa) * sim.v * dt;
    const ny = sim.y + Math.cos(sim.proa) * sim.v * dt;
    const salto = Math.hypot(enrolar(nx, PISTA_W) - sim.x, enrolar(ny, PISTA_H) - sim.y);
    sim.x = enrolar(nx, PISTA_W);
    sim.y = enrolar(ny, PISTA_H);
    if (salto > 0.4) sim.trilha.push(null);
    sim.trilha.push({ x: sim.x, y: sim.y });
    if (sim.trilha.length > 240) sim.trilha.shift();

    estado.pose = { ax: ax, ay: ay, az: az, gx: 0, gy: 0, gz: gz };
    sim.soma.ax += ax;
    sim.soma.ay += ay;
    sim.soma.az += az;
    sim.soma.gz += gz;
    sim.soma.n += 1;

    const sinais = { ax: ax, ay: ay, az: az, gz: gz };
    for (const item of catalogo) {
      if (!item.ativo) continue;
      const valor = sinais[item.eixo];
      const cfg = {
        limiar: item.limiar,
        minMs: item.minMs,
        resfriamentoMs: item.resfriamentoMs,
      };
      if (!detectorAtualizar(cfg, item.det, valor, sim.v, sim.tMs)) continue;
      if (item.origem === "firmware" && item.eixo === "ax") emitirEixo(cfg, item.det);
      else emitirEnsaio(slugTipo(item.nome), sentidoDoEixo(item.eixo, item.limiar), item.det, item.limiar < 0 ? -1 : 1);
    }
  }

  function emitirResumo() {
    const n = sim.soma.n;
    if (!n) return;
    receber(TOPICO, {
      temp: 26.5,
      press: 101325,
      ax: sim.soma.ax / n,
      ay: sim.soma.ay / n,
      az: sim.soma.az / n,
      gx: 0,
      gy: 0,
      gz: sim.soma.gz / n,
      mpu_temp: 31,
    });
    sim.soma.ax = sim.soma.ay = sim.soma.az = sim.soma.gx = sim.soma.gy = sim.soma.gz = sim.soma.n = 0;
  }

  function desenharPista() {
    const canvas = el("canvas-pista");
    if (!canvas) return;
    const { ctx, largura, altura } = preparar(canvas);
    ctx.clearRect(0, 0, largura, altura);
    ctx.fillStyle = "#12151c";
    ctx.fillRect(0, 0, largura, altura);
    ctx.strokeStyle = COR.grade;
    ctx.strokeRect(8, 8, largura - 16, altura - 16);

    const esc = Math.min((largura - 32) / PISTA_W, (altura - 32) / PISTA_H);
    const ox = largura / 2;
    const oy = altura / 2;
    function px(wx, wy) {
      return [ox + wx * esc, oy - wy * esc];
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(108, 182, 255, 0.55)";
    ctx.beginPath();
    let desenhando = false;
    for (const ponto of sim.trilha) {
      if (!ponto) {
        desenhando = false;
        continue;
      }
      const p = px(ponto.x, ponto.y);
      if (!desenhando) {
        ctx.moveTo(p[0], p[1]);
        desenhando = true;
      } else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();

    const c = px(sim.x, sim.y);
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate(-sim.proa);
    ctx.fillStyle = "#222836";
    ctx.strokeStyle = "#e6a23c";
    ctx.lineWidth = 2;
    ctx.fillRect(-7, -12, 14, 24);
    ctx.strokeRect(-7, -12, 14, 24);
    ctx.fillStyle = "#e6a23c";
    ctx.fillRect(-4, -16, 8, 4);
    ctx.restore();
  }

  function quadro(agora) {
    if (!simulando) return;
    if (!sim.ultimoQuadro) sim.ultimoQuadro = agora;
    sim.acumulado += Math.min(100, agora - sim.ultimoQuadro);
    sim.ultimoQuadro = agora;
    while (sim.acumulado >= PASSO_MS) {
      passo();
      sim.acumulado -= PASSO_MS;
    }
    desenharCarro();
    desenharPista();
    pintarMaquina();
    if (agora >= sim.proximoResumo) {
      emitirResumo();
      sim.proximoResumo += 500;
    }
    sim.quadroId = window.requestAnimationFrame(quadro);
  }

  function limparPainel() {
    estado.amostras = [];
    estado.eventos = [];
    estado.ultimoPorTipo = {};
    estado.ultimo = null;
    estado.ultimoResumo = 0;
    estado.pose = null;
    pintarTudo();
  }

  function pararMqtt() {
    if (!clienteMqtt) return;
    const cliente = clienteMqtt;
    clienteMqtt = null;
    cliente.end(true);
  }

  function iniciarSim() {
    simulando = true;
    estado.fase = "simulacao";
    pararMqtt();
    sim.tMs = 0;
    sim.v = 0;
    sim.proa = 0;
    sim.x = 0;
    sim.y = 0;
    sim.paradoMs = 0;
    sim.acumulado = 0;
    sim.ultimoQuadro = 0;
    sim.proximoResumo = performance.now() + 500;
    sim.manobra = null;
    sim.teclas.clear();
    sim.trilha = [{ x: 0, y: 0 }];
    sim.soma = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, n: 0 };
    sim.textoMaquina = "";
    for (const item of catalogo) zerarDetector(item.det);
    limparPainel();
    el("sim-ligar").classList.add("ligado");
    el("sim-ligar").setAttribute("aria-pressed", "true");
    el("sim-ligar").textContent = "Parar simulação";
    pintarLigacao();
    pintarMaquina();
    sim.quadroId = window.requestAnimationFrame(quadro);
  }

  function pararSim() {
    simulando = false;
    window.cancelAnimationFrame(sim.quadroId);
    sim.manobra = null;
    sim.teclas.clear();
    estado.pose = null;
    estado.fase = "conectando";
    el("sim-ligar").classList.remove("ligado");
    el("sim-ligar").setAttribute("aria-pressed", "false");
    el("sim-ligar").textContent = "Simular";
    desenharCarro();
    pintarLigacao();
    conectar();
  }

  function dispararManobra(nome) {
    if (!simulando) return;
    const agora = performance.now();
    if (nome === "arrancada") {
      sim.manobra = { ax: 0.62, ay: 0, az: 0, gz: 0, ate: agora + 280 };
    } else if (nome === "frenagem") {
      if (sim.v < 0.4) sim.v = 1.4;
      sim.manobra = { ax: -0.7, ay: 0, az: 0, gz: 0, ate: agora + 320 };
    } else if (nome === "curva") {
      if (sim.v < 0.4) sim.v = 0.8;
      sim.manobra = { ax: 0.05, ay: 0.55, az: 0, gz: 40, ate: agora + 450 };
    } else if (nome === "impacto") {
      sim.manobra = { ax: 0, ay: 0, az: 1.4, gz: 0, ate: agora + 180 };
    } else if (nome === "curto") {
      sim.manobra = { ax: 0.7, ay: 0, az: 0, gz: 0, ate: agora + 40 };
    }
  }

  function teclaSim(evento, ativa) {
    if (!simulando) return;
    const codigos = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (codigos.indexOf(evento.code) < 0) return;
    if (ativa) sim.teclas.add(evento.code);
    else sim.teclas.delete(evento.code);
    evento.preventDefault();
  }

  el("sim-ligar").addEventListener("click", function () {
    if (simulando) pararSim();
    else iniciarSim();
  });
  document.querySelectorAll("[data-manobra]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      dispararManobra(botao.getAttribute("data-manobra"));
    });
  });
  window.addEventListener("keydown", function (evento) { teclaSim(evento, true); });
  window.addEventListener("keyup", function (evento) { teclaSim(evento, false); });
  window.addEventListener("blur", function () { sim.teclas.clear(); });

  el("nota-carro").textContent =
    "A seta âmbar segue ax (frente quando positivo) e a azul segue ay (esquerda quando positivo). " +
    "O giro do desenho acompanha a taxa gz e não é a proa.";
  el("nota-eventos").textContent =
    "O cartão atualiza quando o evento termina. Limiares compilados na placa: " +
    fmt(LIMIAR_ARRANCADA_G, 2) + " g e " + fmt(LIMIAR_FRENAGEM_G, 2) +
    " g, mínimo de " + DURACAO_MIN_MS + " ms, resfriamento de " + RESFRIAMENTO_MS + " ms.";
  el("dispositivo-topicos").textContent = TOPICO + " e " + TOPICO_EVENTOS;

  const SECOES = {
    "ao-vivo": "Ao vivo",
    eventos: "Eventos",
    simulacao: "Simulação",
    dispositivo: "Dispositivo",
  };
  const mqEstreita = window.matchMedia("(max-width: 800px)");
  let fichaId = null;

  function faixaDoEixo(eixo) {
    return eixo === "gz" ? 2000 : 16;
  }

  function mostrarSecao(id) {
    if (!SECOES[id]) id = "ao-vivo";
    document.querySelectorAll(".secao").forEach(function (secao) {
      secao.hidden = secao.id !== "secao-" + id;
    });
    document.querySelectorAll(".nav-item[data-secao]").forEach(function (botao) {
      const ativo = botao.getAttribute("data-secao") === id;
    botao.classList.toggle("ativo", ativo);
    if (ativo) botao.setAttribute("aria-current", "page");
    else botao.removeAttribute("aria-current");
    });
    el("titulo-secao").textContent = SECOES[id];
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    if (mqEstreita.matches) document.body.classList.add("barra-fechada");
    sincronizarBarra();
    window.requestAnimationFrame(function () {
      if (id === "ao-vivo") {
        desenharGraficos();
        desenharCarro();
      }
      if (id === "simulacao" && simulando) desenharPista();
    });
  }

  function sincronizarBarra() {
    const fechada = document.body.classList.contains("barra-fechada");
    const botao = el("recolher");
    botao.setAttribute("aria-label", fechada ? "Expandir" : "Recolher");
    botao.querySelector(".rotulo").textContent = fechada ? "Expandir" : "Recolher";
    botao.querySelector(".icone").textContent = fechada ? "›" : "‹";
  }

  function aplicarBarraInicial() {
    const salva = localStorage.getItem("tcc-barra") === "1";
    document.body.classList.toggle("barra-fechada", mqEstreita.matches || salva);
    sincronizarBarra();
  }

  function alternarBarra() {
    const fechada = !document.body.classList.contains("barra-fechada");
    document.body.classList.toggle("barra-fechada", fechada);
    sincronizarBarra();
    if (!mqEstreita.matches) localStorage.setItem("tcc-barra", fechada ? "1" : "0");
    window.requestAnimationFrame(function () {
      desenharGraficos();
      if (simulando) desenharPista();
    });
  }

  function origemTexto(item) {
    return item.origem === "firmware" ? "Placa" : "Ensaio";
  }

  function pintarCatalogo() {
    const lista = el("catalogo");
    lista.replaceChildren();
    for (const item of catalogo) {
      const li = document.createElement("li");
      const nome = document.createElement("div");
      const titulo = document.createElement("div");
      titulo.className = "nome";
      titulo.textContent = item.nome;
      const origem = document.createElement("div");
      origem.className = "origem";
      origem.textContent = origemTexto(item) + " · " + item.eixo + " · " + fmt(item.limiar, 2);
      nome.append(titulo, origem);
      const estadoDet = document.createElement("span");
      estadoDet.className = "estado-det";
      estadoDet.dataset.id = item.id;
      estadoDet.textContent = rotuloEstado(item.det);
      const configurar = document.createElement("button");
      configurar.type = "button";
      configurar.textContent = "Configurar";
      configurar.addEventListener("click", function () { abrirFicha(item.id); });
      li.append(nome, estadoDet, configurar);
      if (item.origem !== "firmware") {
        const excluir = document.createElement("button");
        excluir.type = "button";
        excluir.textContent = "Excluir";
        excluir.addEventListener("click", function () {
          const indice = catalogo.indexOf(item);
          if (indice >= 0) catalogo.splice(indice, 1);
          if (fichaId === item.id) limparFicha();
          pintarCatalogo();
          desenharGraficos();
        });
        li.append(excluir);
      }
      lista.append(li);
    }
    sim.textoMaquina = "";
    pintarMaquina();
  }

  function limparFicha() {
    fichaId = null;
    const form = el("ficha-evento");
    form.reset();
    form.elements.minMs.value = String(DURACAO_MIN_MS);
    form.elements.resfriamentoMs.value = String(RESFRIAMENTO_MS);
    form.elements.ativo.checked = true;
    el("ficha-titulo").textContent = "Novo evento";
    el("ficha-nota").textContent = "O evento salvo entra na simulação. A placa não recebe esta ficha.";
    el("ficha-cancelar").hidden = true;
  }

  function abrirFicha(id) {
    const item = catalogo.find(function (candidato) { return candidato.id === id; });
    if (!item) return;
    fichaId = id;
    const form = el("ficha-evento");
    form.elements.nome.value = item.nome;
    form.elements.eixo.value = item.eixo;
    form.elements.limiar.value = String(item.limiar);
    form.elements.minMs.value = String(item.minMs);
    form.elements.resfriamentoMs.value = String(item.resfriamentoMs);
    form.elements.ativo.checked = item.ativo;
    el("ficha-titulo").textContent = "Configurar " + item.nome;
    el("ficha-nota").textContent = item.origem === "firmware"
      ? "Vale na simulação. Na placa este detector continua com o limiar compilado."
      : "Ensaio. O simulador passa a usar estes números.";
    el("ficha-cancelar").hidden = false;
    form.scrollIntoView({ block: "nearest" });
  }

  function lerFicha(form) {
    const nome = form.elements.nome.value.trim();
    const eixo = form.elements.eixo.value;
    const limiar = Number(form.elements.limiar.value);
    const minMs = Number(form.elements.minMs.value);
    const resfriamentoMs = Number(form.elements.resfriamentoMs.value);
    const faixa = faixaDoEixo(eixo);
    if (!nome) return "Dê um nome ao evento.";
    if (!Number.isFinite(limiar) || limiar === 0 || Math.abs(limiar) > faixa) {
      return "O limiar fica entre -" + faixa + " e " + faixa + ", e não pode ser zero.";
    }
    if (!Number.isFinite(minMs) || minMs < 20) return "A duração mínima é de 20 ms.";
    if (!Number.isFinite(resfriamentoMs) || resfriamentoMs < 0) return "O resfriamento não pode ser negativo.";
    return {
      nome: nome,
      eixo: eixo,
      limiar: limiar,
      minMs: minMs,
      resfriamentoMs: resfriamentoMs,
      ativo: form.elements.ativo.checked,
    };
  }

  el("ficha-evento").addEventListener("submit", function (evento) {
    evento.preventDefault();
    const lido = lerFicha(evento.currentTarget);
    if (typeof lido === "string") {
      el("ficha-nota").textContent = lido;
      return;
    }
    if (fichaId) {
      const item = catalogo.find(function (candidato) { return candidato.id === fichaId; });
      if (item) {
        item.nome = lido.nome;
        item.eixo = lido.eixo;
        item.limiar = lido.limiar;
        item.minMs = lido.minMs;
        item.resfriamentoMs = lido.resfriamentoMs;
        item.ativo = lido.ativo;
        zerarDetector(item.det);
      }
    } else {
      catalogo.push(itemCatalogo(lido));
    }
    pintarCatalogo();
    desenharGraficos();
    limparFicha();
    el("ficha-nota").textContent = "Salvo na simulação.";
  });
  el("ficha-cancelar").addEventListener("click", limparFicha);
  el("novo-evento").addEventListener("click", function () {
    limparFicha();
    el("ficha-evento").scrollIntoView({ block: "nearest" });
    el("ficha-evento").elements.nome.focus();
  });

  document.querySelectorAll(".nav-item[data-secao]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      mostrarSecao(botao.getAttribute("data-secao"));
    });
  });
  el("recolher").addEventListener("click", alternarBarra);
  el("abrir-menu").addEventListener("click", alternarBarra);
  el("velo").addEventListener("click", function () {
    document.body.classList.add("barra-fechada");
    sincronizarBarra();
  });
  window.addEventListener("hashchange", function () {
    mostrarSecao(location.hash.slice(1));
  });

  aplicarBarraInicial();
  pintarCatalogo();
  limparFicha();
  mostrarSecao(location.hash.slice(1));

  pintarTudo();
  conectar();
  setInterval(pintarLigacao, 1000);
  window.addEventListener("resize", function () {
    desenharGraficos();
    if (simulando) desenharPista();
  });
})();
