const baseUrl = (process.env.INTERNAL_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }

  const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    cache: 'no-store',
    headers,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
