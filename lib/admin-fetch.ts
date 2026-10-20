export class AdminFetchError extends Error {
  status: number;
  data?: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'AdminFetchError';
    this.status = status;
    this.data = data;
  }
}

export async function adminFetch<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;

  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (err: any) {
    throw new AdminFetchError(err?.message || 'Network request failed', 0);
  }

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/hq/login';
    }
    throw new AdminFetchError('Unauthorized', 401);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new AdminFetchError(
      `Server returned ${res.status} for ${urlStr}`,
      res.status,
      text
    );
  }

  try {
    const data = await res.json();
    return data as T;
  } catch (err: any) {
    throw new AdminFetchError(
      `Failed to parse JSON: ${err?.message || 'Malformed JSON'}`,
      res.status
    );
  }
}
