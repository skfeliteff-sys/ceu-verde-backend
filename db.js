// db.js — Supabase/Postgres.
// Pedidos e catálogo de dropship ficam persistidos no Supabase.
// A chave SERVICE_ROLE deve existir SOMENTE no backend.

const { createClient } = require('@supabase/supabase-js');

let client;
function supabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Supabase não configurado. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    itens: row.itens || [],
    cliente: row.cliente || {},
    endereco: row.endereco || {},
    subtotal: Number(row.subtotal || 0),
    frete: row.frete || null,
    valor: Number(row.valor || 0),
    mpPaymentId: row.mp_payment_id || null,
    pagamento: row.pagamento || 'pendente',
    notaFiscal: row.nota_fiscal || null,
    dropship: row.dropship || null,
    rastreamento: row.rastreamento || null,
    notificacoes: row.notificacoes || {},
    criadoEm: row.criado_em,
    pagoEm: row.pago_em || null
  };
}

function orderToRow(order) {
  return {
    id: String(order.id),
    itens: order.itens || [],
    cliente: order.cliente || {},
    endereco: order.endereco || {},
    subtotal: Number(order.subtotal || 0),
    frete: order.frete || null,
    valor: Number(order.valor || 0),
    mp_payment_id: order.mpPaymentId ? String(order.mpPaymentId) : null,
    pagamento: order.pagamento || 'pendente',
    nota_fiscal: order.notaFiscal || null,
    dropship: order.dropship || null,
    rastreamento: order.rastreamento || null,
    notificacoes: order.notificacoes || {},
    criado_em: order.criadoEm || new Date().toISOString(),
    pago_em: order.pagoEm || null,
    atualizado_em: new Date().toISOString()
  };
}

async function saveOrder(order) {
  const { data, error } = await supabase()
    .from('orders')
    .upsert(orderToRow(order), { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return rowToOrder(data);
}

async function getOrder(id) {
  const { data, error } = await supabase()
    .from('orders')
    .select('*')
    .eq('id', String(id))
    .maybeSingle();
  if (error) throw error;
  return rowToOrder(data);
}

async function getOrderByPaymentId(paymentId) {
  const { data, error } = await supabase()
    .from('orders')
    .select('*')
    .eq('mp_payment_id', String(paymentId))
    .maybeSingle();
  if (error) throw error;
  return rowToOrder(data);
}

async function listarProdutosDropship() {
  const { data, error } = await supabase()
    .from('dropship_products')
    .select('dados')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => r.dados);
}

async function salvarProdutoDropship(produto) {
  const { error } = await supabase()
    .from('dropship_products')
    .upsert({
      id: String(produto.id),
      dados: produto,
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'id' });
  if (error) throw error;
  return produto;
}

async function removerProdutoDropship(id) {
  const { error } = await supabase()
    .from('dropship_products')
    .delete()
    .eq('id', String(id));
  if (error) throw error;
}

module.exports = {
  saveOrder,
  getOrder,
  getOrderByPaymentId,
  listarProdutosDropship,
  salvarProdutoDropship,
  removerProdutoDropship
};
