// routes/orders.js
const express = require('express');
const router = express.Router();
const { saveOrder, getOrder } = require('../db');
const { createPixPayment, createCardPayment, mensagemRecusa } = require('../services/mercadopago');
const { quoteShipping, resumoPedido } = require('../services/shipping');
const { emailPedidoCriado, emailRastreamento } = require('../services/email');

// Chave PÚBLICA do Mercado Pago (segura pra ficar no navegador) usada pelo Card Payment Brick.
router.get('/payment/config', (req, res) => {
  const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
  if (!publicKey) return res.status(503).json({ erro: 'Pagamento com cartão ainda não foi ativado no servidor.' });
  res.json({ publicKey });
});

// Cria um pedido novo, recalcula o frete no servidor e gera a cobranca:
// PIX (padrao) ou CARTAO (quando o corpo traz `cartao` com o token do Card Payment Brick).
router.post('/orders', async (req, res) => {
  try {
    const { itens, cliente, endereco, frete, cartao } = req.body;

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

    const descricao = `Pedido Ceu Verde Amazonia #${orderId}`;
    let pix = null;
    let card = null;
    if (cartao) {
      if (!cartao.token || !cartao.paymentMethodId) {
        return res.status(400).json({ erro: 'Dados do cartao incompletos' });
      }
      card = await createCardPayment({ orderId, valor, descricao, pagador: cliente, cartao, itens });
    } else {
      pix = await createPixPayment({ orderId, valor, descricao, pagador: cliente });
    }
    const pagto = card || pix;
    const recusado = !!card && ['rejected', 'cancelled'].includes(card.status);

    const order = {
      id: orderId,
      itens,
      cliente,
      endereco,
      subtotal: Number(subtotal.toFixed(2)),
      frete: freteReal,
      valor,
      mpPaymentId: pagto.paymentId,
      // 'pago' so e marcado pelo webhook (que tambem emite NF-e e aciona dropship)
      pagamento: recusado ? 'recusado' : 'pendente',
      notaFiscal: null,
      rastreamento: null,
      notificacoes: {},
      criadoEm: new Date().toISOString()
    };
    await saveOrder(order);

    if (card) {
      // Cartao: o resultado ja vem na hora. Aprovado -> o webhook confirma (e-mail, NF-e, dropship).
      const mensagem = recusado ? mensagemRecusa(card.statusDetail) : undefined;
      if (['pending', 'in_process'].includes(card.status)) {
        try {
          const sent = await emailPedidoCriado(order);
          if (!sent?.skipped) { order.notificacoes.pedidoCriado = new Date().toISOString(); await saveOrder(order); }
        } catch (emailErr) { console.error('Falha no e-mail de pedido criado:', emailErr.message); }
      }
      return res.json({ orderId, status: card.status, statusDetail: card.statusDetail, mensagem, frete: freteReal, valor });
    }

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
    if (err.mpStatus && err.mpStatus >= 400 && err.mpStatus < 500) {
      return res.status(422).json({ erro: 'Nao foi possivel processar o cartao. Confira os dados e tente novamente.' });
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
