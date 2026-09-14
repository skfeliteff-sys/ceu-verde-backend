-- Céu Verde Amazônia — banco de dados Supabase
-- Cole este arquivo no Supabase > SQL Editor > New query > Run.

create table if not exists public.orders (
  id text primary key,
  itens jsonb not null default '[]'::jsonb,
  cliente jsonb not null default '{}'::jsonb,
  endereco jsonb not null default '{}'::jsonb,
  subtotal numeric(12,2) not null default 0,
  frete jsonb,
  valor numeric(12,2) not null default 0,
  mp_payment_id text unique,
  pagamento text not null default 'pendente',
  nota_fiscal jsonb,
  dropship jsonb,
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create index if not exists orders_pagamento_idx on public.orders (pagamento);
create index if not exists orders_criado_em_idx on public.orders (criado_em desc);
create index if not exists orders_mp_payment_id_idx on public.orders (mp_payment_id);

create table if not exists public.dropship_products (
  id text primary key,
  dados jsonb not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Segurança: o navegador não precisa acessar essas tabelas diretamente.
-- O backend usa a SERVICE_ROLE, que ignora RLS de forma segura no servidor.
alter table public.orders enable row level security;
alter table public.dropship_products enable row level security;

-- Não criamos políticas públicas. Assim, anon/publishable não lê dados pessoais dos pedidos.
