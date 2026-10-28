import { MapIndex } from '../lib/map-index';
const index = new MapIndex();
let revision = 0;
self.onmessage = ({ data: { id, method, payload } }) => {
  if (method === 'cancel') return;
  try {
    if (method === 'load') { index.load(payload.points); revision = payload.revision; self.postMessage({ id, result: revision }); return; }
    if (payload.revision !== revision) throw new Error('Map data changed. Please try again.');
    const result = method === 'view' ? index.view(payload.bounds, payload.zoom) : method === 'expand' ? index.expand(payload.clusterId) : index.leaves(payload.clusterId, payload.offset);
    self.postMessage({ id, result });
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error('Map processing failed.');
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  }
};
