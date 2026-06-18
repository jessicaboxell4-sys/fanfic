import { useEffect, useRef } from "react";

/**
 * Subscribe to the unified `/api/events/stream` SSE channel.
 *
 * @param {Object<string, (data:any)=>void>} handlers
 *   Map of event kind → handler.  Common kinds:
 *     - "notification"   — payload: {notification_id, kind, title, body, link, created_at}
 *     - "goal-hit"       — payload: full goal doc
 * @param {boolean} enabled
 *   Pass `false` to gate the connection on (e.g. only-when-authed).
 *
 * The hook holds open a single EventSource for the tab's lifetime and
 * cleans it up on unmount.  Re-renders never re-connect — the dep
 * array is intentionally `[]` so the handlers ref stays stable.
 */
export function useEventStream(handlers, enabled = true) {
  const handlersRef = useRef(handlers);
  // Keep the latest handlers without re-creating the EventSource.
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/events/stream`;
    const es = new EventSource(url, { withCredentials: true });
    // Register every kind the caller asked for as a typed listener.
    const onByKind = {};
    Object.keys(handlersRef.current || {}).forEach((kind) => {
      const fn = (e) => {
        try {
          const data = e.data ? JSON.parse(e.data) : {};
          handlersRef.current?.[kind]?.(data);
        } catch { /* malformed — skip */ }
      };
      es.addEventListener(kind, fn);
      onByKind[kind] = fn;
    });
    return () => {
      Object.entries(onByKind).forEach(([kind, fn]) => es.removeEventListener(kind, fn));
      es.close();
    };
  }, [enabled]);
}
