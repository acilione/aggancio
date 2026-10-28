// Request IDs isolate concurrent tasks and let callers discard cancelled work.
export class WorkerClient {
  private worker?: Worker;
  private next = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; cleanup: () => void }>();
  constructor(private create: () => Worker) {}
  get load() { return this.pending.size; }
  private start() {
    if (this.worker) return this.worker;
    const worker = this.create();
    worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      task.cleanup(); this.pending.delete(data.id);
      if (data.error) { const error = new Error(data.error.message); error.name = data.error.name; task.reject(error); }
      else task.resolve(data.result);
    };
    worker.onerror = () => this.dispose(new Error('Background processing failed. Please retry.'));
    worker.onmessageerror = () => this.dispose(new Error('Could not read the background result.'));
    this.worker = worker;
    return worker;
  }
  request<T>(method: string, payload: unknown, signal?: AbortSignal, timeout = 40000): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const worker = this.start();
      const id = ++this.next;
      const abort = () => {
        worker.postMessage({ id, method: 'cancel' });
        const task = this.pending.get(id);
        if (!task) return;
        task.cleanup(); this.pending.delete(id); reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => this.dispose(new Error('Background processing timed out. Please retry.')), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ id, method, payload }); }
      catch (error) { cleanup(); this.pending.delete(id); reject(error); }
    });
  }
  dispose(reason: Error = new DOMException('Cancelled', 'AbortError')) {
    this.worker?.terminate(); this.worker = undefined;
    for (const task of this.pending.values()) { task.cleanup(); task.reject(reason); }
    this.pending.clear();
  }
}
