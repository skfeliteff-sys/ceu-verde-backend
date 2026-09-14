// routes/dropship.js
const express = require('express');
const router = express.Router();
const { buscarProdutos, detalheProduto } = require('../services/cjdropshipping');
const { listarProdutosDropship, salvarProdutoDropship, removerProdutoDropship } = require('../db');

const MARKUP = Number(process.env.DROPSHIP_MARKUP || 1.8); // multiplica o custo (produto+frete) pra chegar no preço de venda
const ADMIN_KEY = process.env.ADMIN_KEY;
const DSERS_PRODUCTS = [
{id:'dsers-ice-roller-pink',name:'Ice Roller Facial Céu Verde — Pink',cat:'rosto',shape:'jar',color:'#e89aaa',price:49.90,rating:4.7,weight:0.08,tag:'Novo',desc:'Massageador facial refrescante reutilizável. Cor Pink.',fonte:'dsers',dsersSku:'14:1052',variante:'Pink',shopifyTitle:'Ice Roller Facial Céu Verde – Massageador Refrescante para Rosto'},
{id:'dsers-ice-roller-purple',name:'Ice Roller Facial Céu Verde — Purple',cat:'rosto',shape:'jar',color:'#9b7bc2',price:49.90,rating:4.7,weight:0.08,tag:'Novo',desc:'Massageador facial refrescante reutilizável. Cor Purple.',fonte:'dsers',dsersSku:'14:29#Purple',variante:'Purple',shopifyTitle:'Ice Roller Facial Céu Verde – Massageador Refrescante para Rosto'}];
 // senha simples só pra você usar as rotas de admin

function checarAdmin(req, res, next) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  next();
}

// O site chama isso ao carregar a página, pra somar os produtos de parceiro
// à vitrine de produtos próprios (array PRODUCTS que já existe no HTML)
router.get('/products/dropship', async (req, res) => {
  try {
    const banco=await listarProdutosDropship(); const catalogo=[...DSERS_PRODUCTS]; for(const p of banco) if(!catalogo.some(x=>x.id===p.id)) catalogo.push(p); res.json(catalogo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha ao carregar produtos de parceiro' });
  }
});

// --- Rotas de admin (protegidas por ADMIN_KEY) ---

// Busca no catálogo da CJ por palavra-chave, pra você escolher o que importar.
// Ex: GET /api/admin/dropship/buscar?q=oleo essencial
router.get('/admin/dropship/buscar', checarAdmin, async (req, res) => {
  try {
    const resultado = await buscarProdutos(req.query.q || '');
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

// Importa um produto específico da CJ (pelo pid) pro catálogo do site,
// já calculando o preço de venda com a margem (DROPSHIP_MARKUP)
router.post('/admin/dropship/importar', checarAdmin, async (req, res) => {
  try {
    const { pid, cat, tag } = req.body;
    const detalhe = await detalheProduto(pid);
    const variante = detalhe.variants?.[0];
    if (!variante) return res.status(400).json({ erro: 'Produto sem variação encontrada na CJ' });

    const custo = Number(variante.variantSellPrice || detalhe.sellPrice || 0);
    const precoVenda = Math.round(custo * MARKUP * 100) / 100;

    const produto = {
      id: 'cj-' + pid,
      name: detalhe.productNameEn,
      cat: cat || 'corpo',
      shape: 'bottle',
      color: '#7f9a4a',
      price: precoVenda,
      rating: 4.6,
      weight: Number(variante.variantWeight || 0.2),
      tag: tag || 'Parceiro',
      desc: detalhe.productNameEn,
      images: detalhe.productImageSet || [],
      fonte: 'parceiro',
      prazoExtra: true,
      cjPid: pid,
      cjVid: variante.vid,
      custoBase: custo
    };

    await salvarProdutoDropship(produto);
    res.json(produto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/admin/dropship/:id', checarAdmin, async (req, res) => {
  try {
    await removerProdutoDropship(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha ao remover produto' });
  }
});

module.exports = router;
