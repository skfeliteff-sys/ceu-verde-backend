// services/cjdropshipping.js
// Integração com a CJ Dropshipping API 2.0 — fornecedor que embala e envia
// os produtos direto pro cliente, sem você precisar ter estoque físico.
// Doc oficial: https://developers.cjdropshipping.com/en/api/api2/

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_API_KEY = process.env.CJ_API_KEY; // gerado em CJ > My CJ > Authorization > API

// A CJ dá um token que dura 24h. Guardamos em memória pra não pedir token toda hora
// (o limite deles é 1 chamada por segundo, e pedir token demais conta nesse limite).
let cachedToken = null;
let cachedTokenExpira = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpira) return cachedToken;

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: CJ_API_KEY })
  });
  const data = await res.json();
  if (!data.result) throw new Error('Erro autenticando na CJ Dropshipping: ' + JSON.stringify(data));

  cachedToken = data.data.accessToken;
  // renova um pouco antes de expirar de verdade, pra margem de segurança
  cachedTokenExpira = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

async function cjFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'CJ-Access-Token': token,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (data.code && data.code !== 200) {
    throw new Error(`Erro CJ (${path}): ${JSON.stringify(data)}`);
  }
  return data.data;
}

// Busca produtos no catálogo da CJ por palavra-chave — usado pelo script de importação,
// pra você escolher quais produtos de outras marcas entram no seu site
async function buscarProdutos(palavraChave, pageSize = 20) {
  const params = new URLSearchParams({ productNameEn: palavraChave, pageSize });
  return cjFetch(`/product/list?${params.toString()}`);
}

// Detalhe completo de um produto (variações, preço de custo, peso, imagens)
async function detalheProduto(pid) {
  return cjFetch(`/product/query?pid=${pid}`);
}

// Cria um pedido de fulfillment na CJ: eles embalam e despacham direto pro seu cliente.
// itens: [{ vid: 'variant id da CJ', quantity: 1 }]
async function criarPedido({ orderId, endereco, cliente, itens }) {
  const payload = {
    orderNumber: orderId, // sua referência — evita duplicar se o webhook chamar 2x
    shippingCountryCode: 'BR',
    shippingProvince: endereco.uf,
    shippingCity: endereco.cidade,
    shippingAddress: `${endereco.rua}, ${endereco.numero}`,
    shippingCustomerName: cliente.nome,
    shippingZip: endereco.cep?.replace(/\D/g, ''),
    shippingPhone: cliente.telefone?.replace(/\D/g, ''),
    fromCountryCode: 'CN',
    logisticName: 'CJPacket', // opção de frete internacional mais comum/econômica na CJ
    products: itens.map(item => ({ vid: item.vid, quantity: item.quantidade }))
  };

  return cjFetch('/shopping/order/createOrder', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Consulta status/rastreio de um pedido já criado na CJ
async function consultarPedido(cjOrderId) {
  return cjFetch(`/shopping/order/getOrderDetail?orderId=${cjOrderId}`);
}

module.exports = { buscarProdutos, detalheProduto, criarPedido, consultarPedido };
