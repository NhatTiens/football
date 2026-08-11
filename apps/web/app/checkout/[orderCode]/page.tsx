import { BillingCheckout } from '../../../components/BillingCheckout';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ orderCode: string }>;
}) {
  const { orderCode } = await params;
  return <BillingCheckout orderCode={orderCode} />;
}
