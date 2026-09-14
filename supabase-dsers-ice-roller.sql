insert into public.dropship_products (id,dados,atualizado_em) values
('dsers-ice-roller-pink','{"id":"dsers-ice-roller-pink","name":"Ice Roller Facial Céu Verde — Pink","cat":"rosto","price":49.90,"weight":0.08,"fonte":"dsers","dsersSku":"14:1052","variante":"Pink"}'::jsonb,now()),
('dsers-ice-roller-purple','{"id":"dsers-ice-roller-purple","name":"Ice Roller Facial Céu Verde — Purple","cat":"rosto","price":49.90,"weight":0.08,"fonte":"dsers","dsersSku":"14:29#Purple","variante":"Purple"}'::jsonb,now())
on conflict(id) do update set dados=excluded.dados, atualizado_em=now();
