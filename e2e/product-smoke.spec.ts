import { expect, test } from '@playwright/test';

test('public product routes render and production checkout is fail-closed', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading').first()).toBeVisible();

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /đăng nhập/i })).toBeVisible();

  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: /chọn gói football ai/i })).toBeVisible();
  await expect(page.getByText(/thanh toán pro đang tạm khóa/i)).toBeVisible();

  const plansResponse = await request.get('http://127.0.0.1:4000/api/billing/plans');
  expect(plansResponse.ok()).toBe(true);
  const plans = (await plansResponse.json()) as {
    plans: Array<{ code: string; purchasable: boolean }>;
  };
  expect(plans.plans.find((plan) => plan.code === 'PRO')?.purchasable).toBe(false);

  await page.goto('/history');
  await expect(page.getByRole('heading', { name: /lịch sử dự đoán/i })).toBeVisible();
  await expect(page.getByText(/trang 1\/1/i)).toBeVisible();
});
