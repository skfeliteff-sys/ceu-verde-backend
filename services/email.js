// services/email.js
// E-mails transacionais da Céu Verde via Resend API.
// A chave RESEND_API_KEY fica somente no backend.

const RESEND_API_URL = 'https://api.resend.com/emails';

function money(v){
  return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function esc(v=''){
  return String(v).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
}

function baseEmail({ title, intro, content, order }){
  const store = process.env.STORE_NAME || 'Céu Verde Amazônia';
  const support = process.env.SUPPORT_EMAIL || '';
  const footer = support ? `Dúvidas? Fale com a gente em ${esc(support)}.` : 'Obrigado por comprar com a gente.';
  return `<!doctype html><html><body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#203126">
  <div style="max-width:620px;margin:0 auto;padding:28px 14px">
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e4e9e2">
      <div style="font-size:22px;font-weight:700;color:#215b3a;margin-bottom:20px">${esc(store)}</div>
      <h1 style="font-size:24px;margin:0 0 12px">${esc(title)}</h1>
      <p style="font-size:16px;line-height:1.55;margin:0 0 22px">${intro}</p>
      ${order ? `<div style="background:#f7faf6;border-radius:12px;padding:14px 16px;margin-bottom:20px"><b>Pedido:</b> ${esc(order.id)}${order.valor != null ? `<br><b>Total:</b> ${money(order.valor)}` : ''}</div>` : ''}
      ${content || ''}
      <p style="font-size:13px;color:#667268;margin-top:28px">${footer}</p>
    </div>
  </div></body></html>`;
}

async function sendEmail({ to, subject, html }){
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn('E-mail não enviado: RESEND_API_KEY/EMAIL_FROM ainda não configurados.');
    return { skipped:true, reason:'EMAIL_NOT_CONFIGURED' };
  }
  if (!to) return { skipped:true, reason:'NO_RECIPIENT' };

  const res = await fetch(RESEND_API_URL, {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from, to:[to], subject, html })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) {
    const err = new Error(data.message || `Falha ao enviar e-mail (${res.status})`);
    err.code = 'EMAIL_SEND_ERROR';
    throw err;
  }
  return data;
}

function itemsHtml(order){
  const itens = (order.itens || []).map(i => {
    const variante = i.variante ? ` <span style="color:#6a746d">(${esc(i.variante)})</span>` : '';
    return `<tr><td style="padding:8px 0">${esc(i.nome || 'Produto')}${variante} × ${Number(i.quantidade || 1)}</td><td style="padding:8px 0;text-align:right">${money(Number(i.preco || 0) * Number(i.quantidade || 1))}</td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse">${itens}</table>`;
}

async function emailPedidoCriado(order){
  const html = baseEmail({
    title:'Recebemos seu pedido',
    intro:`Olá, ${esc(order.cliente?.nome || 'cliente')}! Seu pedido foi criado e está aguardando a confirmação do pagamento.`,
    order,
    content:`${itemsHtml(order)}<p style="margin-top:18px"><b>Pagamento:</b> aguardando confirmação.</p>`
  });
  return sendEmail({ to:order.cliente?.email, subject:`Pedido ${order.id} recebido — Céu Verde`, html });
}

async function emailPagamentoConfirmado(order){
  const html = baseEmail({
    title:'Pagamento confirmado ✅',
    intro:`Recebemos o pagamento do seu pedido. Agora vamos seguir com a preparação e emissão da nota fiscal.`,
    order,
    content:`${itemsHtml(order)}<p style="margin-top:18px"><b>Status:</b> pagamento aprovado.</p>`
  });
  return sendEmail({ to:order.cliente?.email, subject:`Pagamento confirmado — pedido ${order.id}`, html });
}

async function emailNotaFiscal(order){
  const nota = order.notaFiscal || {};
  const link = nota.pdfUrl ? `<p><a href="${esc(nota.pdfUrl)}" style="display:inline-block;background:#215b3a;color:#fff;text-decoration:none;padding:11px 16px;border-radius:9px">Abrir DANFE / Nota Fiscal</a></p>` : '<p>A nota fiscal foi autorizada. O documento ficará disponível no acompanhamento do pedido.</p>';
  const html = baseEmail({
    title:'Sua nota fiscal foi emitida',
    intro:'A nota fiscal do seu pedido foi autorizada.',
    order,
    content:link
  });
  return sendEmail({ to:order.cliente?.email, subject:`Nota fiscal do pedido ${order.id}`, html });
}

async function emailRastreamento(order){
  const r = order.rastreamento || {};
  const codigo = esc(r.codigo || '');
  const link = r.url ? `<p><a href="${esc(r.url)}" style="display:inline-block;background:#215b3a;color:#fff;text-decoration:none;padding:11px 16px;border-radius:9px">Acompanhar entrega</a></p>` : '';
  const transportadora = r.transportadora ? `<p><b>Transportadora:</b> ${esc(r.transportadora)}</p>` : '';
  const html = baseEmail({
    title:'Seu pedido foi enviado 📦',
    intro:'Seu pedido já possui informações de rastreamento.',
    order,
    content:`${transportadora}<p><b>Código de rastreio:</b> ${codigo}</p>${link}`
  });
  return sendEmail({ to:order.cliente?.email, subject:`Pedido ${order.id} enviado — rastreamento`, html });
}

module.exports = { emailPedidoCriado, emailPagamentoConfirmado, emailNotaFiscal, emailRastreamento };
