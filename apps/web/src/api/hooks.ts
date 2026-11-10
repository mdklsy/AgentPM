import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './client.js';

export interface ApiState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/** 极简数据获取 hook：path 为 null 时不请求；reload 为后台静默刷新（保留旧数据，页面不闪）。 */
export function useApi<T>(path: string | null): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({
    data: undefined,
    error: undefined,
    loading: path !== null,
  });
  const version = useRef(0);
  const lastPath = useRef<string | null>(path);

  const load = useCallback(async () => {
    if (!path) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }
    const v = ++version.current;
    // 仅 path 变化或首次加载时进入 loading（整页骨架）；同 path 的 reload 静默后台刷新，
    // 避免操作成功后整个页面被 Spinner 替换、页签/滚动位置丢失（视觉上像整页刷新）
    const pathChanged = lastPath.current !== path;
    lastPath.current = path;
    setState((s) =>
      pathChanged || !s.data ? { ...s, loading: true, error: undefined } : { ...s, error: undefined },
    );
    try {
      const data = await api.get<T>(path);
      if (v === version.current) setState({ data, error: undefined, loading: false });
    } catch (e) {
      if (v === version.current)
        setState((s) => ({
          data: pathChanged ? undefined : s.data, // path 变化后的失败回到空态；同 path 保留旧数据
          error: e instanceof ApiError ? e.message : String(e),
          loading: false,
        }));
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
