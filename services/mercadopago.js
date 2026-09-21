// services/mercadopago.js
// Cria uma cobrança PIX de verdade via API do Mercado Pago.
// Doc oficial: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/pix

const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_BASE = 'https://api.mercadopago.com';

async function createPixPayment({ orderId, valor, descricao, pagador }) {
  const res = await fetch(`${MP_BASE}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MP_TOKEN}`,
      // evita cobrança duplicada em caso de retry de rede
      'X-Idempotency-Key': orderId
    },
    body: JSON.stringify({
      transaction_amount: Number(valor.toFixed(2)),
      description: descricao,
      payment_method_id: 'pix',
      external_reference: orderId,
      payer: {
        email: pagador.email,
        first_name: pagador.nome?.split(' ')[0] || 'Cliente',
        last_name: pagador.nome?.split(' ').slice(1).join(' ') || '-'
      },
      notification_url: process.env.PUBLIC_URL + '/api/webhook/mercadopago'
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error('Erro Mercado Pago: ' + JSON.stringify(data));
  }

  return {
    paymentId: data.id,
    status: data.status, // "pending" até o cliente pagar
    qrCode: data.point_of_interaction?.transaction_data?.qr_code, // copia-e-cola
    qrCodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64, // imagem do QR
    expiraEm: data.date_of_expiration
  };
}

// Pagamento com CARTÃO (crédito/débito) usando o token gerado no navegador pelo Card Payment Brick.
// O número do cartão NUNCA passa pelo nosso servidor: só recebemos o `token` de uso único.
async function createCardPayment({ orderId, valor, descricao, pagador, cartao, itens }) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MP_TOKEN}`,
    'X-Idempotency-Key': orderId
  };
  // Device ID (gerado pelo SDK do Mercado Pago no navegador) ajuda a análise antifraude.
  if (cartao.deviceId) headers['X-meli-session-id'] = String(cartao.deviceId);

  const cpfDigits = String(pagador.cpf || '').replace(/\D/g, '');
  const identification = cartao.payer?.identification?.number
    ? { type: cartao.payer.identification.type || 'CPF', number: String(cartao.payer.identification.number) }
    : (cpfDigits ? { type: 'CPF', number: cpfDigits } : undefined);

  const body = {
    transaction_amount: Number(valor.toFixed(2)),
    token: cartao.token,
    description: descricao,
    installments: Math.max(1, Number(cartao.installments) || 1),
    payment_method_id: cartao.paymentMethodId,
    external_reference: orderId,
    statement_descriptor: 'CEUVERDE',
    payer: {
      email: pagador.email,
      first_name: pagador.nome?.split(' ')[0] || 'Cliente',
      last_name: pagador.nome?.split(' ').slice(1).join(' ') || '-',
      identification
    },
    additional_info: {
      items: (itens || []).map(i => ({
        id: String(i.id),
        title: String(i.nome || i.id).slice(0, 250),
        quantity: Math.max(1, Number(i.quantidade) || 1),
        unit_price: Number(Number(i.preco || 0).toFixed(2))
      }))
    },
    notification_url: process.env.PUBLIC_URL + '/api/webhook/mercadopago'
  };
  if (cartao.issuerId) body.issuer_id = Number(cartao.issuerId);

  const res = await fetch(`${MP_BASE}/v1/payments`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error('Erro Mercado Pago (cartão): ' + JSON.stringify({ status: res.status, message: data.message, cause: data.cause }));
    err.mpStatus = res.status;
    throw err;
  }
  return {
    paymentId: data.id,
    status: data.status,             // approved | in_process | pending | rejected
    statusDetail: data.status_detail // ex.: cc_rejected_insufficient_amount
  };
}

// Traduz o motivo da recusa em uma mensagem que o cliente entende.
function mensagemRecusa(statusDetail) {
  const m = {
    cc_rejected_insufficient_amount: 'Saldo/limite insuficiente. Tente outro cartão ou pague com PIX.',
    cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
    cc_rejected_bad_filled_date: 'Confira a data de validade.',
    cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV).',
    cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
    cc_rejected_call_for_authorize: 'O banco pediu autorização. Ligue para o número atrás do cartão ou use outro cartão.',
    cc_rejected_card_disabled: 'Cartão desativado. Ligue para o banco para ativá-lo ou use outro cartão.',
    cc_rejected_duplicated_payment: 'Você já fez um pagamento com esse valor. Confira seu e-mail ou tente novamente em alguns minutos.',
    cc_rejected_max_attempts: 'Limite de tentativas atingido. Use outro cartão ou pague com PIX.',
    cc_rejected_high_risk: 'Não foi possível aprovar este pagamento. Tente outro cartão ou pague com PIX.',
    cc_rejected_blacklist: 'Não foi possível aprovar este pagamento. Tente outro cartão ou pague com PIX.'
  };
  return m[statusDetail] || 'O pagamento não foi aprovado. Tente outro cartão ou pague com PIX.';
}

// Consulta o status atual de um pagamento (usado pelo webhook pra confirmar)
async function getPayment(paymentId) {
  const res = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
  });
  if (!res.ok) throw new Error('Erro ao consultar pagamento no Mercado Pago');
  return res.json();
}

module.exports = { createPixPayment, createCardPayment, mensagemRecusa, getPayment };
