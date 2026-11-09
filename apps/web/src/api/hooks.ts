import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './client.js';

export interface ApiState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/** 极简数据获取 hook：path 为 null 时不请求；返回 reload 手动刷新。 */
export function useApi<T>(path: string | null): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({
    data: undefined,
    error: undefined,
    loading: path !== null,
  });
  const version = useRef(0);

  const load = useCallback(async () => {
    if (!path) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }
    const v = ++version.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await api.get<T>(path);
      if (v === version.current) setState({ data, error: undefined, loading: false });
    } catch (e) {
      if (v === version.current)
        setState({
          data: undefined,
          error: e instanceof ApiError ? e.message : String(e),
          loading: false,
        });
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: () => void load() };
}

/** 变更动作：loading/错误/成功信息一站式 */
export function useAction() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setRunning(true);
      setError(null);
      setMessage(null);
      try {
        const r = await fn();
        if (success) setMessage(success);
        return r;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
        return undefined;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  return {
    run,
    running,
    error,
    message,
    clear: () => {
      setError(null);
      setMessage(null);
    },
  };
}
