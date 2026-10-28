import Supercluster from 'supercluster';
export interface MapPoint { id: string; latitude: number; longitude: number }
export interface MapMark { id?: string; clusterId?: number; count: number; latitude: number; longitude: number }
export class MapIndex {
  private index = new Supercluster<{ id: string }>({ radius: 60, maxZoom: 19 });
  load(points: MapPoint[]) {
    this.index.load(points.map(point => ({ type: 'Feature', properties: { id: point.id }, geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] } })));
  }
  view(bounds: [number, number, number, number], zoom: number): MapMark[] {
    // Only visible clusters become DOM nodes; coarsen exceptionally crowded views.
    let level = Math.min(19, Math.max(0, Math.floor(zoom)));
    let features = this.index.getClusters(bounds, level);
    while (features.length > 400 && level > 0) features = this.index.getClusters(bounds, --level);
    return features.map(feature => ({ latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0],
      ...('cluster' in feature.properties ? { clusterId: feature.properties.cluster_id, count: feature.properties.point_count } : { id: feature.properties.id, count: 1 }),
    }));
  }
  expand(clusterId: number) { return this.index.getClusterExpansionZoom(clusterId); }
  leaves(clusterId: number, offset = 0) { return this.index.getLeaves(clusterId, 20, offset).map(point => point.properties.id); }
}
