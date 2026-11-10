/** API 错误：携带 HTTP 状态与后端机器可读 code */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) unauthorizedHandler?.();
    throw new ApiError(
      json?.error?.message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
      json?.error?.code,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  /** multipart/form-data 上传（浏览器自动设 content-type 边界，不手动覆盖）。 */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', body: form });
    const json = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/v1/auth/')) unauthorizedHandler?.();
      throw new ApiError(
        json?.error?.message ?? `上传失败（HTTP ${res.status}）`,
        res.status,
        json?.error?.code,
      );
    }
    return json as T;
  },
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  return (
    '?' +
    entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  );
}
