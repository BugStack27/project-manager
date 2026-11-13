import { useCallback, useEffect, useRef, useState } from 'react';

/** 轻提示：统一入口 notify(msg, kind)，2.6s 后自动消失 */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const notify = useCallback((msg, kind) => {
    setToast({ msg, kind: kind || 'info', id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer.current);
  }, [toast]);

  return { toast, notify };
}
