const baseUrl = (process.env.INTERNAL_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
