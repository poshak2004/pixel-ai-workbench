import { useSyncExternalStore } from 'react';

/** Tiny hash router: routes are plain paths like "/tables/tbl_1". */
function current() {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function navigate(path: string) {
  if (current() !== path) window.location.hash = path;
}

export function useRoute(): { path: string; parts: string[] } {
  const path = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    current,
  );
  return { path, parts: path.split('/').filter(Boolean) };
}
