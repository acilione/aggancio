import Supercluster from 'supercluster';
export interface MapPoint { id: string; latitude: number; longitude: number; approximate?: boolean; kind?: 'venue' | 'address' | 'street' | 'city' }
export interface MapMark { id?: string; clusterId?: number; count: number; approximateCount: number; latitude: number; longitude: number }
export class MapIndex {
  private index = new Supercluster<{ id: string; approximateCount: number }, { approximateCount: number }>({ radius: 60, maxZoom: 19,
    map: properties => ({ approximateCount: properties.approximateCount }),
    reduce: (sum, properties) => { sum.approximateCount += properties.approximateCount; },
  });
  load(points: MapPoint[]) {
    this.index.load(points.map(point => ({ type: 'Feature', properties: { id: point.id, approximateCount: Number(!!point.approximate) }, geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] } })));
  }
  view(bounds: [number, number, number, number], zoom: number): MapMark[] {
    // Query at the actual zoom. Coarsening just this viewport can move cluster
    // centres outside its bounds and silently lose events near the edges.
    // Include boundary points despite longitude normalization/quantization error.
    const epsilon = 0.000001;
    const features = this.index.getClusters([bounds[0] - epsilon, bounds[1] - epsilon, bounds[2] + epsilon, bounds[3] + epsilon], Math.min(19, Math.max(0, Math.floor(zoom))));
    return features.map(feature => ({ latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0], approximateCount: feature.properties.approximateCount,
      ...('cluster' in feature.properties ? { clusterId: feature.properties.cluster_id, count: feature.properties.point_count } : { id: feature.properties.id, count: 1 }),
    }));
  }
  expand(clusterId: number) { return this.index.getClusterExpansionZoom(clusterId); }
  leaves(clusterId: number, offset = 0) { return this.index.getLeaves(clusterId, 20, offset).map(point => point.properties.id); }
}
