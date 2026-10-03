-- WhatsApp, ciudad y estado de cada asesor (para enviarle el contrato de retiro por desempleo y otros documentos).
-- Ejecutar en Supabase: SQL Editor → pegar → Run
alter table profiles add column if not exists phone text; -- solo dígitos con lada país, ej. 5216681234567
-- Ciudad y estado del asesor: su domicilio en el contrato ("EL PROFESIONISTA")
alter table profiles add column if not exists city text;
alter table profiles add column if not exists state text;
