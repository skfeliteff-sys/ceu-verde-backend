// services/shipping.js
// Cotacao real de frete via Melhor Envio.

function somenteDigitos(v = '') { return String(v).replace(/\D/g, ''); }
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function config() {
  const ambiente = String(process.env.MELHOR_ENVIO_AMBIENTE || 'sandbox').toLowerCase();
  return {
    token: process.env.MELHOR_ENVIO_TOKEN || '',
    originCep: somenteDigitos(process.env.MELHOR_ENVIO_ORIGIN_CEP || ''),
    baseUrl: ambiente === 'producao' || ambiente === 'production'
      ? 'https://melhorenvio.com.br'
      : 'https://sandbox.melhorenvio.com.br',
    userAgent: process.env.MELHOR_ENVIO_USER_AGENT || 'Ceu Verde Amazonia (suporte@seudominio.com)',
    width: num(process.env.PACKAGE_WIDTH_CM, 15),
    height: num(process.env.PACKAGE_HEIGHT_CM, 10),
    length: num(process.env.PACKAGE_LENGTH_CM, 20),
    packageWeight: num(process.env.PACKAGE_WEIGHT_KG, 0.2),
    freeShipThreshold: num(process.env.FREE_SHIP_THRESHOLD, 150),
    services: (process.env.MELHOR_ENVIO_SERVICES || '').trim()
  };
}

function resumoPedido(itens = []) {
  const subtotal = itens.reduce((s, item) => {
    const preco = Number(item.preco) || 0;
    const qtd = Math.max(1, Number(item.quantidade) || 1);
    return s + preco * qtd;
  }, 0);
  const pesoProdutos = itens.reduce((s, item) => {
    const peso = Math.max(0, Number(item.peso) || 0);
    const qtd = Math.max(1, Number(item.quantidade) || 1);
    return s + peso * qtd;
  }, 0);
  return { subtotal, pesoProdutos };
}

async function quoteShipping({ cepDestino, itens, serviceId }) {
  const cfg = config();
  const destino = somenteDigitos(cepDestino);
  if (!cfg.token) {
    const e = new Error('MELHOR_ENVIO_TOKEN nao configurado');
    e.code = 'SHIPPING_NOT_CONFIGURED';
    throw e;
  }
  if (cfg.originCep.length !== 8) {
    const e = new Error('MELHOR_ENVIO_ORIGIN_CEP nao configurado');
    e.code = 'SHIPPING_NOT_CONFIGURED';
    throw e;
  }
  if (destino.length !== 8) {
    const e = new Error('CEP de destino invalido');
    e.code = 'INVALID_DESTINATION_CEP';
    throw e;
  }
  if (!Array.isArray(itens) || !itens.length) {
    const e = new Error('Carrinho vazio');
    e.code = 'EMPTY_CART';
    throw e;
  }

  const { subtotal, pesoProdutos } = resumoPedido(itens);
  const pesoTotal = Math.max(0.1, Number((pesoProdutos + cfg.packageWeight).toFixed(3)));
  const body = {
    from: { postal_code: cfg.originCep },
    to: { postal_code: destino },
    volumes: [{
      width: cfg.width,
      height: cfg.height,
      length: cfg.length,
      weight: pesoTotal,
      insurance: Number(subtotal.toFixed(2))
    }],
    options: { receipt: false, own_hand: false }
  };
  if (cfg.services) body.services = cfg.services;

  const resp = await fetch(`${cfg.baseUrl}/api/v2/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': cfg.userAgent
    },
    body: JSON.stringify(body)
  });

  let data;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    const detalhe = data?.message || data?.error || `HTTP ${resp.status}`;
    const e = new Error(`Melhor Envio: ${detalhe}`);
    e.code = 'SHIPPING_PROVIDER_ERROR';
    e.status = resp.status;
    e.providerResponse = data;
    throw e;
  }

  const lista = Array.isArray(data) ? data : [];
  let options = lista
    .filter(x => x && !x.error && (x.custom_price != null || x.price != null))
    .map(x => {
      const carrierPrice = Number(x.custom_price ?? x.price ?? 0);
      const deliveryTime = Number(x.custom_delivery_time ?? x.delivery_time ?? 0);
      const empresa = x.company?.name || 'Transportadora';
      return {
        id: String(x.id),
        serviceId: String(x.id),
        name: `${empresa} — ${x.name || 'Entrega'}`,
        company: empresa,
        service: x.name || 'Entrega',
        carrierPrice: Number(carrierPrice.toFixed(2)),
        price: subtotal >= cfg.freeShipThreshold ? 0 : Number(carrierPrice.toFixed(2)),
        freeShipping: subtotal >= cfg.freeShipThreshold,
        deliveryTime,
        days: deliveryTime > 0 ? `até ${deliveryTime} dias úteis` : 'prazo informado pela transportadora'
      };
    })
    .sort((a,b) => a.price - b.price || a.deliveryTime - b.deliveryTime);

  if (serviceId != null) {
    options = options.filter(o => String(o.serviceId) === String(serviceId));
  }
  if (!options.length) {
    const e = new Error('Nenhuma opcao de frete disponivel para este CEP');
    e.code = 'NO_SHIPPING_OPTIONS';
    throw e;
  }
  return { options, subtotal: Number(subtotal.toFixed(2)), pesoTotal };
}

module.exports = { quoteShipping, resumoPedido };
