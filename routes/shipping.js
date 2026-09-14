// routes/shipping.js
const express = require('express');
const router = express.Router();
const { quoteShipping } = require('../services/shipping');

router.post('/shipping/quote', async (req, res) => {
  try {
    const { cepDestino, itens } = req.body || {};
    const result = await quoteShipping({ cepDestino, itens });
    res.json(result);
  } catch (err) {
    console.error('Erro ao cotar frete:', err.message);
    const status = err.code === 'SHIPPING_NOT_CONFIGURED' ? 503
      : err.code === 'INVALID_DESTINATION_CEP' || err.code === 'EMPTY_CART' ? 400
      : err.code === 'NO_SHIPPING_OPTIONS' ? 422 : 502;
    res.status(status).json({
      erro: err.code === 'SHIPPING_NOT_CONFIGURED'
        ? 'Frete real ainda nao foi ativado no servidor.'
        : err.code === 'NO_SHIPPING_OPTIONS'
          ? 'Nenhuma opcao de frete disponivel para este CEP.'
          : 'Nao foi possivel calcular o frete agora.',
      codigo: err.code || 'SHIPPING_ERROR'
    });
  }
});

module.exports = router;
