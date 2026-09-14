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

// Consulta o status atual de um pagamento (usado pelo webhook pra confirmar)
async function getPayment(paymentId) {
  const res = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
  });
  if (!res.ok) throw new Error('Erro ao consultar pagamento no Mercado Pago');
  return res.json();
}

module.exports = { createPixPayment, getPayment };
