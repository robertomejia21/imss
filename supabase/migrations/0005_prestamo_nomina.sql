-- Producto: Préstamo vía nómina (IMSS-Bienestar, pensionados Ley 73 y jubilados IMSS).
-- El flujo del agente está en src/lib/ai/prompt.ts (sección 5.2).
-- Se crea sin que la IA lo ofrezca: activar "Lo ofrece la IA" en /productos cuando estén
-- confirmados los pendientes con el socio (financiera, CAT, formatos y aviso de privacidad).
insert into products (name, description, offered_by_ai, active, sort_order) values (
  'Préstamo vía nómina',
  'Préstamo con descuento vía nómina o pensión, sin aval, depósito a su cuenta de nómina o pensión. Para trabajadores activos de IMSS-Bienestar, pensionados IMSS Ley 73 y jubilados IMSS. Flujo completo en la sección 5.2.',
  false, true, 35
) on conflict (name) do nothing;
