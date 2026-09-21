// routes/webhook.js
// Mercado Pago chama essa URL toda vez que o status de um pagamento muda.
// É aqui que a mágica do "automático" acontece: pagamento aprovado -> emite nota.

const express = require('express');
const router = express.Router();
const { getPayment } = require('../services/mercadopago');
const { emitirNotaFiscal } = require('../services/focusnfe');
const { criarPedido: criarPedidoCJ } = require('../services/cjdropshipping');
const { getOrder, getOrderByPaymentId, saveOrder } = require('../db');
const { emailPagamentoConfirmado } = require('../services/email');

router.post('/webhook/mercadopago', async (req, res) => {
  // responde rápido — o Mercado Pago só precisa de um 200 OK, o processamento pode continuar depois
  res.sendStatus(200);

  try {
    const paymentId = req.query.id || req.body?.data?.id;
    if (!paymentId) return;

    const payment = await getPayment(paymentId);
    if (payment.status !== 'approved') return; // ignora pending/rejected/etc

    // Cartao aprova quase instantaneamente: o webhook pode chegar antes do pedido ser gravado. Tenta por ~10s.
    let order = null;
    for (let tentativa = 0; tentativa < 6 && !order; tentativa++) {
      order = (await getOrderByPaymentId(paymentId)) || (await getOrder(payment.external_reference));
      if (!order) await new Promise(r => setTimeout(r, 2000));
    }
    if (!order) {
      console.error('Pedido não encontrado pro pagamento', paymentId);
      return;
    }

    if (order.pagamento === 'pago') return; // já processado, evita duplicar

    order.pagamento = 'pago';
    order.pagoEm = new Date().toISOString();
    order.notificacoes = order.notificacoes || {};
    await saveOrder(order);

    if (!order.notificacoes.pagamentoConfirmado) {
      try {
        const sent = await emailPagamentoConfirmado(order);
        if (!sent?.skipped) {
          order.notificacoes.pagamentoConfirmado = new Date().toISOString();
          await saveOrder(order);
        }
      } catch (emailErr) { console.error('Falha no e-mail de pagamento:', emailErr.message); }
    }

    // dispara a emissão da nota fiscal (nota cobre TODOS os itens, próprios ou de parceiro —
    // pra Receita Federal não importa quem despacha, só que a venda foi feita por você)
    const nota = await emitirNotaFiscal(order);
    order.notaFiscal = { status: nota.status, ref: nota.ref };
    await saveOrder(order);
    console.log(`Pedido ${order.id}: pago e nota fiscal em processamento (ref ${nota.ref})`);

    // se o pedido tem item de dropship (fonte:'parceiro'), manda pra CJ despachar direto pro cliente
    const itensParceiro = order.itens.filter(i => i.fonte === 'parceiro' && i.cjVid);
    if (itensParceiro.length) {
      try {
        const pedidoCJ = await criarPedidoCJ({
          orderId: order.id,
          endereco: order.endereco,
          cliente: order.cliente,
          itens: itensParceiro.map(i => ({ vid: i.cjVid, quantidade: i.quantidade }))
        });
        order.dropship = { status: 'enviado_pra_cj', cjOrderId: pedidoCJ.orderId || pedidoCJ.orderNumber };
        await saveOrder(order);
        console.log(`Pedido ${order.id}: itens de parceiro enviados pra CJ Dropshipping`);
      } catch (errCJ) {
        // não deixa travar o pedido todo — o pagamento e a nota já estão ok,
        // só o envio pro fornecedor que falhou e precisa de atenção manual
        order.dropship = { status: 'erro', mensagem: errCJ.message };
        await saveOrder(order);
        console.error(`Pedido ${order.id}: falha ao criar pedido na CJ Dropshipping:`, errCJ);
      }
    }
    const itensDSers = order.itens.filter(i => i.fonte === 'dsers' && i.dsersSku);
    if (itensDSers.length) {
      order.dropship = { status:'aguardando_dsers', fornecedor:'DSers/AliExpress', itens: itensDSers.map(i => ({ sku:i.dsersSku, variante:i.variante, quantidade:i.quantidade, produto:i.shopifyTitle || i.nome })) };
      await saveOrder(order);
      console.log(`Pedido ${order.id}: itens DSers identificados.`);
    }

  } catch (err) {
    console.error('Erro processando webhook:', err);
  }
});

module.exports = router;
