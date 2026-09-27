// Read only routing intent, never store recovery tokens here.
export function isRecoveryReturn(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  return hash.get('type') === 'recovery' || hash.has('error') || url.searchParams.has('error') || url.pathname.endsWith('/update-password');
}
