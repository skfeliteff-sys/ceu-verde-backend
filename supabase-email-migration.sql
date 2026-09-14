-- Céu Verde Amazônia — migração para e-mails automáticos e rastreamento
-- Rode UMA VEZ no Supabase > SQL Editor.

alter table public.orders
  add column if not exists rastreamento jsonb,
  add column if not exists notificacoes jsonb not null default '{}'::jsonb;

comment on column public.orders.notificacoes is 'Controle de e-mails enviados para evitar duplicidade de webhooks';
comment on column public.orders.rastreamento is 'Código, URL e transportadora do envio';
