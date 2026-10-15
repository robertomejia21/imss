import { createClient } from "@/lib/supabase/server";
import { ProductsPanel } from "@/components/products-panel";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getProducts } from "@/lib/products";

export const metadata = { title: "Productos" };

export default async function ProductsPage() {
  const supabase = await createClient();
  const products = await getProducts(supabase, { activeOnly: false });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Productos"
        description="Servicios que ofrecemos. Un prospecto puede pedir información y registrarse en varios a la vez. Los activos aparecen en el formulario de registro y en el CRM; los marcados para el agente de WhatsApp, él los ofrece por WhatsApp usando su descripción."
      />
      <Card>
        <CardHeader title={`Catálogo (${products.length})`} />
        <ProductsPanel products={products} />
      </Card>
    </div>
  );
}
