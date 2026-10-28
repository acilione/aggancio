import { fetchGancio } from '../lib/events';
const active = new Map<number, AbortController>();
self.onmessage = async ({ data: { id, method, payload } }) => {
  if (method === 'cancel') { active.get(id)?.abort(); return; }
  const controller = new AbortController(); active.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 30000);
  try { self.postMessage({ id, result: await fetchGancio(payload, controller.signal) }); }
  catch (reason) {
    const error = reason instanceof Error ? reason : new Error('Source unavailable.');
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  } finally { clearTimeout(timeout); active.delete(id); }
};
