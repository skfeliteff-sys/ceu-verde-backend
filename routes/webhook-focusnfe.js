// routes/webhook-focusnfe.js
// Focus NFe também pode chamar uma URL sua quando o status da nota muda
// (autorizada, rejeitada, etc). Configure essa URL no painel do Focus NFe.
// Doc: https://focusnfe.com.br/doc/#webhooks

const express = require('express');
const router = express.Router();
const { getOrder, saveOrder } = require('../db');
const { emailNotaFiscal } = require('../services/email');

router.post('/webhook/focusnfe', async (req, res) => {
  res.sendStatus(200);

  const { ref, status, caminho_danfe, caminho_xml_nota_fiscal, mensagem_sefaz } = req.body;
  const order = await getOrder(ref);
  if (!order) return;

  order.notaFiscal = {
    status,
    ref,
    pdfUrl: caminho_danfe,
    xmlUrl: caminho_xml_nota_fiscal,
    mensagem: mensagem_sefaz
  };
  order.notificacoes = order.notificacoes || {};
  await saveOrder(order);

  if (/autoriz/i.test(String(status || '')) && !order.notificacoes.notaFiscal) {
    try {
      const sent = await emailNotaFiscal(order);
      if (!sent?.skipped) {
        order.notificacoes.notaFiscal = new Date().toISOString();
        await saveOrder(order);
      }
    } catch (emailErr) { console.error('Falha no e-mail da NF-e:', emailErr.message); }
  }

  console.log(`Nota fiscal do pedido ${ref}: ${status}`);
});

module.exports = router;
