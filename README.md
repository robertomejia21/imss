# CRM Trámites IMSS

CRM para dar seguimiento a prospectos que llegan por WhatsApp (campañas de Facebook, formulario web o mensaje directo), atendidos por un asistente de IA (Claude) conectado a WhatsApp mediante **Green API**.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage, Realtime) · Anthropic Claude · Green API · Tailwind CSS 4

## Qué incluye

| Módulo | Ruta | Descripción |
|---|---|---|
| Inicio | `/` | KPIs, embudo, origen de prospectos, conversaciones recientes y casos que requieren asesor |
| Conversaciones | `/inbox` | Bandeja tipo WhatsApp en tiempo real: notas de voz con transcripción, imágenes/PDF con resultado del OCR, pausar o reactivar la IA, responder como asesor |
| Prospectos | `/leads`, `/leads/[id]` | Tabla con filtros y ficha completa: datos (CURP/NSS validados), chat, trámites, documentos y bitácora |
| Embudo | `/pipeline` | Kanban de estados con arrastrar y soltar |
| Documentos | `/documentos` | Cola de revisión de documentos verificados por OCR (aprobar o rechazar) |
| Configuración | `/configuracion` | Instrucciones del asistente, estado de Green API, webhook e integraciones |
| Registro público | `/registro` | Formulario para anuncios; al enviarlo abre WhatsApp con el folio del prospecto |
| API de captación | `POST /api/leads` | Para Meta Lead Ads, Zapier o Make |
| Webhook | `POST /api/webhooks/green-api` | Recibe los mensajes de WhatsApp |

### Flujo de un mensaje

1. Green API envía el mensaje al webhook. Se guarda y se responde `200` de inmediato.
2. En segundo plano (`after()`):
   - **Audio**: se descarga, se guarda en Storage y se transcribe con OpenAI.
   - **Imagen o PDF**: se guarda y Claude hace OCR estructurado (tipo de documento, nombre, CURP, NSS, vigencia, etc.). Después se aplican reglas: dígito verificador de CURP y NSS, vigencia de la INE, coincidencia con los datos del prospecto y legibilidad. El resultado puede ser `valido`, `con_observaciones` o `invalido`.
   - **Texto**: espera unos segundos para agrupar los mensajes enviados seguidos.
3. El agente (Claude) lee el historial, que incluye las transcripciones y los resultados del OCR, y responde **siempre con texto**. Puede usar estas herramientas:
   - `guardar_datos_lead`: guarda nombre, CURP, NSS, trámite, etc.
   - `actualizar_estado`: mueve al prospecto en el embudo.
   - `solicitar_asesor_humano`: pausa la IA y avisa al equipo.
   - `consultar_expediente`: consulta los trámites y documentos del prospecto.
4. Un candado por prospecto evita respuestas duplicadas. Si la IA está en pausa o un asesor ya respondió, no se envía nada.

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Crea las tablas, las políticas de seguridad, Realtime y el bucket privado `media`.
3. En **Authentication → Users**, crea los usuarios de los asesores (correo y contraseña). Conviene desactivar el registro público en *Authentication → Providers → Email*.
4. Copia la URL, la `anon key` y la `service_role key` en `.env.local`.

### 2. Variables de entorno
```bash
cp .env.example .env.local   # ya existe una copia; llena los valores
```
| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Agente y OCR |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` (predeterminado) o `claude-sonnet-5-5` (más económico) |
| `GREEN_API_ID_INSTANCE`, `GREEN_API_TOKEN_INSTANCE` | Credenciales de la instancia en Green API |
| `GREEN_API_WEBHOOK_TOKEN` | Cadena secreta que valida que los webhooks vienen de Green API |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Número del negocio (por ejemplo `5215512345678`) para el botón del formulario |
| `OPENAI_API_KEY` | Transcripción de notas de voz (`gpt-4o-mini-transcribe`). Claude no recibe audio directamente |
| `INTAKE_API_KEY` | Protege `POST /api/leads` |

### 3. Correr en local
```bash
npm install
npm run dev
```
Para que Green API alcance tu equipo en local, expón el puerto con `ngrok http 3000` o `cloudflared tunnel --url http://localhost:3000`.

### 4. Green API
1. Crea una instancia en [green-api.com](https://green-api.com) y vincula el WhatsApp del negocio escaneando el QR.
2. En `/configuracion`, escribe la URL pública (HTTPS) y pulsa **Configurar webhook en Green API**. También puedes hacerlo manualmente en la consola de Green API:
   - Webhook URL: `https://TU-DOMINIO/api/webhooks/green-api`
   - Webhook URL Token: el mismo valor de `GREEN_API_WEBHOOK_TOKEN`
   - Activa los webhooks de mensajes entrantes, de mensajes salientes y de estado.

### 5. Despliegue (Vercel)
- Configura las mismas variables de entorno.
- El webhook declara `maxDuration = 300` porque el OCR y la respuesta de la IA pueden tardar. Revisa el límite de duración de funciones de tu plan.

## Campañas de Facebook

- **Clic a WhatsApp:** el anuncio abre `wa.me/TU_NUMERO`. El primer mensaje crea el prospecto y lo atiende la IA.
- **Formulario web:** usa `https://TU-DOMINIO/registro?utm_source=facebook&utm_campaign=NOMBRE` como destino. Se guardan los UTM y `fbclid`. Al enviar, la persona llega a WhatsApp con un mensaje que incluye su folio (`REG-XXXXXX`), y así su chat se vincula con su registro.
- **Meta Lead Ads (formulario instantáneo):** conecta Zapier o Make a `POST /api/leads` con `"send_whatsapp": true`. El CRM le escribe primero por WhatsApp.

## Pendiente: entrenar al agente

Las instrucciones actuales del agente son **provisionales** ([`src/lib/ai/prompt.ts`](src/lib/ai/prompt.ts)). Se pueden reemplazar sin tocar código desde `/configuracion → Instrucciones del asistente`. Falta definir qué trámites se atienden, los requisitos de cada uno, los precios, el tono y las preguntas frecuentes.

## Estructura

```
src/
  app/
    (auth)/login/            Inicio de sesión
    (crm)/                   CRM protegido (inicio, inbox, leads, pipeline, documentos, configuración)
    (crm)/actions.ts         Server Actions
    registro/                Formulario público + página de gracias
    api/webhooks/green-api/  Webhook de WhatsApp
    api/leads/               API de captación
  lib/
    ai/agent.ts              Agente: historial, herramientas, candado y envío
    ai/ocr.ts                OCR con Claude (salida estructurada) y reglas de validación
    ai/transcribe.ts         Transcripción de notas de voz
    ai/prompt.ts             Instrucciones base del agente
    whatsapp/green-api.ts    Cliente de Green API
    whatsapp/inbound.ts      Procesamiento de mensajes entrantes
    leads.ts                 Alta de prospectos (formulario y API)
  proxy.ts                   Protección de rutas (antes "middleware")
supabase/migrations/         Esquema de base de datos
```

## Notas

- **Teléfonos de México:** WhatsApp puede identificar los números con prefijo `52` o `521`. Por eso el CRM compara los últimos 10 dígitos para vincular un registro del formulario con su chat. Si un envío proactivo (`send_whatsapp`) falla, revisa el formato del número en tu instancia.
- **Fallbacks de seguridad:** las llamadas a Claude usan `fallbacks: "default"`. Si el modelo rechaza una solicitud, la API la reintenta automáticamente con el modelo de respaldo recomendado. Si aun así no hay respuesta, el prospecto se marca como “requiere asesor”.
- **Seguridad:** todas las tablas tienen RLS. Solo los usuarios autenticados acceden al CRM. Los webhooks y el formulario usan la service role desde el servidor.
