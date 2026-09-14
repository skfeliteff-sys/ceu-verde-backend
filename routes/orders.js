// routes/orders.js
const express = require('express');
const router = express.Router();
const { saveOrder, getOrder } = require('../db');
const { createPixPayment } = require('../services/mercadopago');
const { quoteShipping, resumoPedido } = require('../services/shipping');
const { emailPedidoCriado, emailRastreamento } = require('../services/email');

// Cria um pedido novo, recalcula o frete no servidor e gera a cobranca PIX.
router.post('/orders', async (req, res) => {
  try {
    const { itens, cliente, endereco, frete } = req.body;

    if (!itens?.length || !cliente?.email || !endereco?.cep) {
      return res.status(400).json({ erro: 'Pedido incompleto (itens, cliente ou endereco faltando)' });
    }
    if (!frete?.serviceId) {
      return res.status(400).json({ erro: 'Selecione uma opcao de frete antes de confirmar o pedido' });
    }

    // Nao confia no preco de frete vindo do navegador: cota novamente no servidor.
    const cotacao = await quoteShipping({
      cepDestino: endereco.cep,
      itens,
      serviceId: frete.serviceId
    });
    const freteReal = cotacao.options[0];
    const { subtotal } = resumoPedido(itens);
    const valor = Number((subtotal + freteReal.price).toFixed(2));
    const orderId = 'CV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    const pix = await createPixPayment({
      orderId,
      valor,
      descricao: `Pedido Ceu Verde Amazonia #${orderId}`,
      pagador: cliente
    });

    const order = {
      id: orderId,
      itens,
      cliente,
      endereco,
      subtotal: Number(subtotal.toFixed(2)),
      frete: freteReal,
      valor,
      mpPaymentId: pix.paymentId,
      pagamento: 'pendente',
      notaFiscal: null,
      rastreamento: null,
      notificacoes: {},
      criadoEm: new Date().toISOString()
    };
    await saveOrder(order);

    // E-mail de pedido criado. Falha no provedor não impede a compra.
    try {
      const sent = await emailPedidoCriado(order);
      if (!sent?.skipped) { order.notificacoes.pedidoCriado = new Date().toISOString(); await saveOrder(order); }
    } catch (emailErr) { console.error('Falha no e-mail de pedido criado:', emailErr.message); }

    res.json({
      orderId,
      qrCode: pix.qrCode,
      qrCodeBase64: pix.qrCodeBase64,
      expiraEm: pix.expiraEm,
      frete: freteReal,
      valor
    });
  } catch (err) {
    console.error(err);
    if (err.code && err.code.startsWith('SHIPPING_') || err.code === 'NO_SHIPPING_OPTIONS') {
      return res.status(err.code === 'SHIPPING_NOT_CONFIGURED' ? 503 : 422).json({
        erro: err.code === 'SHIPPING_NOT_CONFIGURED'
          ? 'Frete real ainda nao foi ativado no servidor.'
          : 'Nao foi possivel confirmar a cotacao de frete. Calcule novamente.'
      });
    }
    res.status(500).json({ erro: 'Falha ao criar pedido/pagamento' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ erro: 'Pedido nao encontrado' });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha ao consultar pedido' });
  }
});

// Atualiza rastreamento e dispara e-mail ao cliente.
// Pode ser chamado pelo painel/admin ou, no futuro, por webhook da Shopify/DSers.
router.post('/orders/:id/tracking', async (req, res) => {
  try {
    const adminKey = req.get('x-admin-key');
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ erro:'Não autorizado' });
    }
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ erro:'Pedido não encontrado' });

    const { codigo, url, transportadora } = req.body || {};
    if (!codigo) return res.status(400).json({ erro:'Informe o código de rastreamento' });

    const previousCode = order.rastreamento?.codigo;
    order.rastreamento = { codigo:String(codigo), url:url || null, transportadora:transportadora || null, atualizadoEm:new Date().toISOString() };
    order.notificacoes = order.notificacoes || {};
    await saveOrder(order);

    // Só envia novamente se o código mudou ou nunca foi enviado.
    if (previousCode !== String(codigo) || !order.notificacoes.rastreamento) {
      try {
        const sent = await emailRastreamento(order);
        if (!sent?.skipped) {
          order.notificacoes.rastreamento = new Date().toISOString();
          order.notificacoes.rastreamentoCodigo = String(codigo);
          await saveOrder(order);
        }
      } catch (emailErr) { console.error('Falha no e-mail de rastreamento:', emailErr.message); }
    }

    res.json({ ok:true, orderId:order.id, rastreamento:order.rastreamento });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro:'Falha ao atualizar rastreamento' });
  }
});

module.exports = router;
