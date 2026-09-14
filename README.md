# Backend Céu Verde Amazônia — pagamento PIX + nota fiscal automática

## O que isso faz
1. Cliente finaliza a compra no site → backend cria uma cobrança PIX real no Mercado Pago
2. Cliente paga → Mercado Pago avisa o backend (webhook)
3. Backend confirma o pagamento e chama o Focus NFe pra emitir a nota
4. Focus NFe autoriza a nota → avisa o backend (webhook) → site mostra o link do PDF

## 1. Instalar
```bash
cd ceu-verde-backend
npm install
cp .env.example .env
```

## 2. Preencher o `.env`
- `MERCADOPAGO_ACCESS_TOKEN`: em https://www.mercadopago.com.br/developers/panel → sua aplicação → Credenciais de produção
- `FOCUSNFE_TOKEN`: no painel do Focus NFe → sua empresa → Token. **Comece com `FOCUSNFE_AMBIENTE=homologacao`** pra testar sem emitir nota de verdade — só troque pra `producao` depois de validar um pedido de teste inteiro.
- `PUBLIC_URL`: preenche depois que fizer o deploy (passo 4)

## 3. Rodar localmente pra testar
```bash
npm start
```
O site (o HTML) precisa apontar pra esse backend. No `<head>` do `ceu-verde-amazonia.html`, antes do `<script>` principal, adicione:
```html
<script>window.CEU_VERDE_API_BASE = 'http://localhost:3000/api';</script>
```
Só que **o Mercado Pago não consegue mandar webhook pra `localhost`** — pra testar o fluxo de pagamento de ponta a ponta local, use um túnel tipo `ngrok http 3000` e coloque a URL do ngrok em `PUBLIC_URL`.

## 4. Deploy (produção)
Suba o `ceu-verde-backend` num serviço como Render, Railway ou uma VPS. Depois:
- Atualize `PUBLIC_URL` no `.env` pra URL pública real
- No `ceu-verde-amazonia.html`, troque `CEU_VERDE_API_BASE` pra essa mesma URL + `/api`
- No painel do Focus NFe, configure a URL de webhook: `https://SEU-BACKEND/api/webhook/focusnfe`

## 5. Dropshipping (CJ Dropshipping) — produtos que complementam o catálogo

Isso deixa você vender produtos de outras marcas (mesma linha: naturais/cosméticos) sem
ter estoque — a CJ embala e despacha direto pro seu cliente quando o pedido é pago.

**Como fica o fluxo:**
1. Você importa produtos do catálogo da CJ pro seu site (rota de admin, abaixo)
2. O site busca esses produtos em `/api/products/dropship` e mistura na vitrine, com um
   selo de "produto de parceiro" e prazo de entrega maior
3. Cliente compra normalmente (PIX) — pode ter produto próprio e de parceiro no mesmo pedido
4. Pagamento aprovado → nota fiscal é emitida (cobre o pedido inteiro) **e**, separadamente,
   os itens de parceiro são enviados automaticamente pra CJ despachar

**Configurar:**
1. Crie conta em https://cjdropshipping.com e gere uma API Key em *My CJ > Authorization > API*
2. Preencha `CJ_API_KEY` no `.env`
3. Escolha um `ADMIN_KEY` (senha sua) no `.env` — protege as rotas de importação
4. Ajuste `DROPSHIP_MARKUP` se quiser outra margem (padrão: preço de custo + 80%)

**Importar um produto** (depois de achar o `pid` dele navegando/buscando no site da CJ,
ou via `GET /api/admin/dropship/buscar?q=oleo essencial`):
```bash
curl -X POST http://localhost:3000/api/admin/dropship/importar \
  -H "Content-Type: application/json" \
  -H "x-admin-key: SEU_ADMIN_KEY" \
  -d '{"pid": "ID_DO_PRODUTO_NA_CJ", "cat": "corpo", "tag": "Parceiro"}'
```
Isso salva o produto em `dropship-products.json` já com preço de venda calculado.
Pra remover: `DELETE /api/admin/dropship/:id` com o mesmo header.

**No HTML do site**, adicione (perto de onde já tem `window.CEU_VERDE_API_BASE`) o trecho
que busca e mescla o catálogo de parceiro — os comentários no arquivo mostram onde.

**Pontos de atenção específicos do dropship:**
- **Prazo de entrega da CJ costuma ser bem mais longo** (produtos vindos de fora, normalmente
  1–4 semanas dependendo do modal de frete) — por isso o selo "produto de parceiro" no site
  é importante: o cliente precisa saber antes de comprar.
- **Frete internacional da CJ é cobrado à parte do frete nacional dos seus produtos próprios.**
  Hoje o cálculo de frete do site (Mercado Envios) só cobre os itens próprios — o custo de
  frete internacional do parceiro já está embutido no `DROPSHIP_MARKUP` ao importar. Se quiser
  cobrar frete de parceiro separado e mais preciso, dá pra evoluir isso depois.
- **Confirme o regime de importação com seu contador.** Produtos que a CJ despacha direto de
  fora do Brasil podem ter tributação e retenção na alfândega diferentes de produto nacional —
  isso é uma decisão de negócio/fiscal, não só técnica.

## Pontos de atenção antes de ir pra produção
- **Os campos fiscais em `services/focusnfe.js` (CFOP, CSOSN/CST, NCM) estão com valores padrão genéricos.** Confirme com seu contador se eles batem com o regime tributário da empresa e com cada categoria de produto (açaí, cosméticos, etc. podem ter NCMs diferentes). Nota fiscal com código errado é problema real com o Fisco, não só um bug de sistema.
- **Pagamento por cartão não está automatizado.** Capturar número de cartão direto num formulário próprio (como o site fazia antes, de forma simulada) é uma violação séria de PCI-DSS se feito de verdade. Se quiser aceitar cartão, o caminho certo é usar o **Checkout Pro** do Mercado Pago (ele redireciona o cliente pra uma página segura do próprio Mercado Pago) — posso montar essa parte depois se quiser.
- O banco de dados aqui é um arquivo `orders.json` simples, bom pra começar. Se o volume de pedidos crescer, migrar pra Postgres é o próximo passo.

## 6. Frete real — Melhor Envio
O checkout agora usa `POST /api/shipping/quote` e nao calcula mais frete por formula ficticia.
A cotacao e feita no backend para que o token nunca fique exposto no HTML.

No `.env`, preencha:
- `MELHOR_ENVIO_TOKEN`: token da integracao Melhor Envio
- `MELHOR_ENVIO_AMBIENTE=sandbox` durante os testes; depois `producao`
- `MELHOR_ENVIO_ORIGIN_CEP`: CEP real de onde saem os produtos
- `MELHOR_ENVIO_USER_AGENT`: nome da aplicacao + e-mail de suporte tecnico
- `PACKAGE_WIDTH_CM`, `PACKAGE_HEIGHT_CM`, `PACKAGE_LENGTH_CM` e `PACKAGE_WEIGHT_KG`: medidas/peso reais da embalagem usada

O backend recalcula a mesma opcao de frete ao criar o pedido. Assim, alterar o preco do frete pelo navegador nao muda o valor cobrado no PIX.
O frete selecionado e salvo junto do pedido e passa a compor o total do pagamento.

## 7. Banco de dados — Supabase
Os pedidos e o catálogo de dropship agora são persistidos no Supabase/Postgres, em vez de `orders.json`.

1. No Supabase, abra **SQL Editor > New query**.
2. Cole todo o conteúdo de `supabase.sql` e clique em **Run**.
3. No `.env` do backend, preencha:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Rode `npm install` novamente para instalar `@supabase/supabase-js`.
5. Reinicie o backend.

A `SUPABASE_SERVICE_ROLE_KEY` é secreta e deve ficar somente no backend. O HTML/site público não precisa dela.
As tabelas usam RLS e não têm política pública, evitando que clientes consultem pedidos de outras pessoas diretamente pelo navegador.


## E-mails automáticos
O backend está preparado para enviar e-mails via Resend em quatro momentos:
1. Pedido criado/aguardando pagamento.
2. Pagamento aprovado pelo webhook do Mercado Pago.
3. NF-e autorizada pelo webhook da Focus NFe.
4. Rastreamento cadastrado em `POST /api/orders/:id/tracking` (header `x-admin-key`).

Antes de ativar, rode `supabase-email-migration.sql` no Supabase e configure `RESEND_API_KEY` e `EMAIL_FROM` no `.env`. O sistema registra os envios em `orders.notificacoes` para reduzir e-mails duplicados quando um webhook é reenviado.
