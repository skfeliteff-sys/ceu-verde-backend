// services/focusnfe.js
// Emite a nota fiscal automaticamente via API do Focus NFe.
// Doc oficial: https://focusnfe.com.br/doc/

const FOCUS_TOKEN = process.env.FOCUSNFE_TOKEN;
// Sandbox pra testar sem gerar nota de verdade. Trocar pra produção quando estiver validado.
const FOCUS_BASE = process.env.FOCUSNFE_AMBIENTE === 'producao'
  ? 'https://api.focusnfe.com.br'
  : 'https://homologacao.focusnfe.com.br';

// ⚠️ IMPORTANTE: os campos abaixo (ncm, cfop, cst/csosn, origem, unidade) são fiscais
// e variam por produto e pelo regime tributário da empresa (Simples Nacional, etc).
// Preencha esses valores em products.json com seu contador ANTES de emitir em produção —
// código errado aqui gera nota fiscal com erro tributário de verdade.

async function emitirNotaFiscal(order) {
  const ref = order.id; // referência única, evita nota duplicada pro mesmo pedido

  const payload = {
    natureza_operacao: 'Venda de mercadoria',
    data_emissao: new Date().toISOString(),
    tipo_documento: 1, // saída
    finalidade_emissao: 1, // NF-e normal
    consumidor_final: 1,
    presenca_comprador: 2, // 2 = não presencial, internet

    nome_destinatario: order.cliente.nome,
    cpf_destinatario: order.cliente.cpf?.replace(/\D/g, ''),
    email_destinatario: order.cliente.email,
    telefone_destinatario: order.cliente.telefone?.replace(/\D/g, ''),

    logradouro_destinatario: order.endereco.rua,
    numero_destinatario: order.endereco.numero,
    bairro_destinatario: order.endereco.bairro,
    municipio_destinatario: order.endereco.cidade,
    uf_destinatario: order.endereco.uf,
    cep_destinatario: order.endereco.cep?.replace(/\D/g, ''),

    items: order.itens.map((item, i) => ({
      numero_item: i + 1,
      codigo_produto: item.codigo || item.id,
      descricao: item.nome,
      cfop: item.cfop || '5102', // padrão comum p/ venda dentro do estado — CONFIRMAR com contador
      unidade_comercial: item.unidade || 'UN',
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: item.preco.toFixed(2),
      valor_bruto: (item.preco * item.quantidade).toFixed(2),
      unidade_tributavel: item.unidade || 'UN',
      quantidade_tributavel: item.quantidade,
      valor_unitario_tributavel: item.preco.toFixed(2),
      icms_origem: item.origem ?? 0,
      icms_situacao_tributaria: item.csosn || '102', // padrão Simples Nacional s/ crédito — CONFIRMAR
      pis_situacao_tributaria: '07',
      cofins_situacao_tributaria: '07'
    }))
  };

  const res = await fetch(`${FOCUS_BASE}/v2/nfe?ref=${ref}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64')
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (res.status >= 400) {
    throw new Error('Erro Focus NFe: ' + JSON.stringify(data));
  }

  // Focus NFe processa de forma assíncrona: status inicial vem "processando_autorizacao"
  return { ref, status: data.status, raw: data };
}

// Consulta o status/link do PDF e XML depois de emitida
async function consultarNota(ref) {
  const res = await fetch(`${FOCUS_BASE}/v2/nfe/${ref}`, {
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64') }
  });
  return res.json();
}

module.exports = { emitirNotaFiscal, consultarNota };
