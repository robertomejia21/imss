import Image from "next/image";
import type { ReactNode } from "react";
import { COMPANY } from "@/lib/company";
import { formatPhone } from "@/lib/utils";

export const metadata = { title: "Aviso de privacidad", description: `Aviso de privacidad integral de ${COMPANY.name}` };

const UPDATED = "15 de octubre de 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

export default function AvisoDePrivacidadPage() {
  const contact = [
    COMPANY.privacyEmail && `el correo ${COMPANY.privacyEmail}`,
    COMPANY.whatsapp && `WhatsApp al ${formatPhone(COMPANY.whatsapp)}`,
  ]
    .filter(Boolean)
    .join(" o por ");

  return (
    <main className="min-h-screen bg-cream">
      <div className="bg-brand-600 px-4 pb-20 pt-8 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Image src="/logo.png" alt="" width={44} height={44} className="rounded-xl" />
          <span className="font-semibold">{COMPANY.name}</span>
        </div>
        <div className="mx-auto mt-8 max-w-3xl">
          <h1 className="text-3xl font-semibold leading-tight">Aviso de privacidad integral</h1>
          <p className="mt-2 text-sm text-brand-100">Última actualización: {UPDATED}</p>
        </div>
      </div>

      <div className="mx-auto -mt-12 max-w-3xl px-4 pb-12">
        <article className="space-y-6 rounded-2xl border border-line bg-paper p-6 shadow-lg sm:p-10">
          <Section title="1. Responsable de tus datos personales">
            <p>
              <strong>{COMPANY.name}</strong> (en adelante, “nosotros”) es responsable del tratamiento de tus datos personales, conforme a la Ley
              Federal de Protección de Datos Personales en Posesión de los Particulares y su normativa aplicable.
              {COMPANY.address ? ` Nuestro domicilio es ${COMPANY.address}.` : ""}
            </p>
            <p>
              Somos un despacho independiente de asesoría en seguridad social. <strong>No somos</strong> el Instituto Mexicano del Seguro Social
              (IMSS), IMSS-Bienestar, una AFORE ni una dependencia de gobierno, ni actuamos en su nombre.
            </p>
          </Section>

          <Section title="2. Datos personales que recabamos">
            <p>Según el servicio que solicites, podemos recabar:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Identificación:</strong> nombre, CURP, RFC, Número de Seguridad Social, fecha de nacimiento, clave de elector e imagen de tu
                identificación oficial (INE).
              </li>
              <li>
                <strong>Contacto:</strong> teléfono y WhatsApp, correo electrónico y domicilio.
              </li>
              <li>
                <strong>Laborales y de pensión:</strong> dependencia o institución que te paga, número de empleado o matrícula, delegación, régimen
                de pensión, talones de pago de nómina, pensión o jubilación, y semanas cotizadas.
              </li>
              <li>
                <strong>Patrimoniales y financieros:</strong> estados de cuenta, cuenta o CLABE, comprobantes de pago, AFORE, créditos vigentes con
                descuento vía nómina o pensión y capacidad de descuento.
              </li>
              <li>
                <strong>Imagen:</strong> fotografía de tu rostro y fotografía sosteniendo tu INE, cuando el trámite lo requiere para verificar tu
                identidad.
              </li>
              <li>
                <strong>Firma:</strong> la que plasmas en formatos de autorización que nos envías.
              </li>
            </ul>
            <p>
              Las fotografías de tu rostro usadas para verificar tu identidad pueden considerarse <strong>datos sensibles</strong>; solo las
              tratamos con tu consentimiento expreso, que nos das al aceptar este aviso y enviarlas. <strong>No te pedimos datos de salud</strong>,
              contraseñas, NIP ni códigos de tus cuentas bancarias.
            </p>
            <p>
              Si nos compartes datos de otras personas (por ejemplo, referencias personales o familiares), declaras que les informaste y que
              cuentas con su autorización.
            </p>
          </Section>

          <Section title="3. Para qué usamos tus datos">
            <p>
              <strong>Finalidades necesarias</strong> para darte el servicio que solicitas:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Atender tu solicitud de información por WhatsApp, formulario u otros medios y darte seguimiento.</li>
              <li>
                Gestionar el servicio que contrates: alta en el IMSS, retiro por desempleo de tu AFORE, salario topado y otros servicios de nuestro
                catálogo.
              </li>
              <li>
                En préstamos con descuento vía nómina o pensión: revisar tu elegibilidad y tu capacidad de descuento, y canalizar tu solicitud a la
                institución financiera correspondiente.
              </li>
              <li>Verificar tu identidad y la autenticidad de tus documentos y de tus pagos (incluida su consulta en el sistema SPEI de Banxico).</li>
              <li>Elaborar fichas de pago, contratos y demás documentos del servicio, y cumplir obligaciones legales y fiscales.</li>
            </ul>
            <p>
              <strong>Finalidades secundarias</strong> (no son necesarias para el servicio): enviarte información de otros servicios que podrían
              interesarte y hacer encuestas de calidad. Si no deseas que usemos tus datos para estas finalidades, avísanos por los medios de la
              sección 6; esto no afectará el servicio que nos pediste.
            </p>
          </Section>

          <Section title="4. Con quién compartimos tus datos">
            <p>Solo compartimos tus datos cuando es necesario para el servicio que solicitaste:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>IMSS, IMSS-Bienestar, tu AFORE y otras autoridades, para realizar los trámites que nos encargas.</li>
              <li>
                Instituciones financieras y plataformas de nómina con las que operamos préstamos vía nómina o pensión (por ejemplo, la institución
                que revisa tu capacidad mediante el formato de autorización que firmas), para evaluar y, en su caso, otorgar tu crédito.
              </li>
              <li>Autoridades competentes, cuando la ley lo exija.</li>
            </ul>
            <p>
              También usamos proveedores que tratan datos por nuestra cuenta y bajo nuestras instrucciones (mensajería de WhatsApp, almacenamiento
              en la nube, lectura automática de documentos y herramientas de inteligencia artificial que nos ayudan a atenderte). Ellos no pueden
              usar tus datos para fines propios.
            </p>
          </Section>

          <Section title="5. Atención automatizada">
            <p>
              Parte de la atención por WhatsApp la da un asistente virtual, que capta tus datos y revisa tus documentos de forma automática. Ninguna
              decisión final sobre tu trámite o tu crédito se toma solo de forma automatizada: siempre la revisa una persona de nuestro equipo o la
              institución correspondiente. En cualquier momento puedes pedir que te atienda un asesor humano.
            </p>
          </Section>

          <Section title="6. Tus derechos ARCO y cómo revocar tu consentimiento">
            <p>
              Tienes derecho a <strong>acceder</strong> a tus datos, <strong>rectificarlos</strong>, <strong>cancelarlos</strong> u{" "}
              <strong>oponerte</strong> a su uso (derechos ARCO), así como a revocar tu consentimiento y a limitar el uso o divulgación de tus datos.
            </p>
            <p>
              Para ejercerlos, envíanos tu solicitud por {contact || "los medios de contacto que te proporcionó tu asesor"}, con tu nombre, un medio
              para responderte, una copia de tu identificación y la descripción clara de lo que solicitas. Te responderemos en un plazo máximo de 20
              días hábiles y, si procede, lo haremos efectivo dentro de los 15 días hábiles siguientes.
            </p>
            <p>
              Ten en cuenta que, si revocas tu consentimiento o pides cancelar tus datos mientras un trámite está en curso, es posible que no
              podamos concluirlo, y que algunos datos debemos conservarlos por obligaciones legales.
            </p>
          </Section>

          <Section title="7. Conservación y seguridad">
            <p>
              Conservamos tus datos mientras dure la relación y el tiempo necesario para cumplir obligaciones legales. Aplicamos medidas de
              seguridad administrativas, técnicas y físicas para protegerlos contra daño, pérdida, alteración o uso no autorizado.
            </p>
          </Section>

          <Section title="8. Cambios a este aviso">
            <p>
              Podemos modificar este aviso por cambios legales o de nuestros servicios. La versión vigente siempre estará publicada en esta página,
              con su fecha de actualización.
            </p>
          </Section>

          <Section title="9. Consentimiento">
            <p>
              Al aceptar este aviso (por ejemplo, al responder que estás de acuerdo por WhatsApp o al marcar la casilla del formulario de registro)
              y entregarnos tus datos, consientes su tratamiento en los términos aquí descritos. Si consideras que tu derecho a la protección de
              datos fue vulnerado, puedes acudir ante la autoridad garante en materia de protección de datos personales.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}
