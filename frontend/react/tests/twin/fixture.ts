import type { Site, TwinData, TwinEntity, Zone } from '../../src/types';

export function twinFixture(site: Site, scenario: string | null): TwinData {
  const first = site.id === 1;
  const labels = first ? ['North access', 'Service bay', 'East junction', 'Loading chamber'] : ['South intake', 'Workshop', 'Transfer drift', 'Survey station'];
  const zones: Zone[] = labels.map((name, index) => ({
    id: site.id * 100 + index, site: site.id, level: scenario === 'twin-levels' ? (index < 2 ? 12 : 24) : null,
    level_name: scenario === 'twin-levels' ? (index < 2 ? 'Upper workings' : 'Lower workings') : undefined,
    code: index === 1 && scenario === 'twin-long' ? 'SERVICE-BAY-WITH-AN-UNUSUALLY-LONG-SURVEY-ZONE-REFERENCE' :
      first ? ['N-01', 'S-02', 'E-03', 'L-04'][index] : `SOUTH-${index + 1}`,
    name, zone_type: 'OPERATIONAL', description: '', is_restricted: false, is_hazardous: false, geometry: {}, active: true,
  }));
  const rect = (id: string, label: string, x: number, y: number, w: number, h: number, zone?: Zone) => ({
    id, type: 'Feature', properties: { label, zone_id: zone?.id },
    geometry: { type: 'Polygon', coordinates: [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]] },
  });
  const features = [
    rect('intake', 'Intake drift', 26, 42, 146, 11),
    rect('haulage', 'Main haulage', 160, 42, 12, 147),
    rect('crosscut', 'Crosscut', 166, 111, 188, 11),
    rect('return', 'Return drift', 166, 175, 146, 11),
    rect('spur', 'Service spur', 280, 57, 11, 60),
    rect('north', labels[0], 0, 21, 81, 53, zones[0]),
    rect('bay', labels[1], 248, 17, 78, 50, zones[1]),
    rect('east', labels[2], 332, 91, 80, 51, zones[2]),
    rect('loading', labels[3], 272, 154, 93, 57, zones[3]),
  ];
  const observed = Date.now() - 180_000;
  const at = (index: number) => ({ zone_id: zones[index].id, zone_code: zones[index].code });
  const entities: TwinEntity[] = first ? [
    { id: 'TRK-104', node_id: 'TRK-104', label: 'Maya Chen', kind: 'personnel', role: 'WEARABLE', status: 'ONLINE', evidence: 'CONFIRMED', observed_at: observed, ...at(0) },
    { id: 'TRK-207', node_id: 'TRK-207', label: scenario === 'twin-long' ? 'Service vehicle with an unusually long fleet maintenance name' : 'Service vehicle 12', kind: 'asset', role: 'WEARABLE', status: 'STALE', evidence: 'LAST_KNOWN', observed_at: observed - 3_600_000, ...at(1) },
    { id: 'ANC-031', node_id: 'ANC-031', label: 'Anchor 031', kind: 'device', role: 'ANCHOR', status: 'ONLINE', evidence: 'CONFIRMED', observed_at: observed, ...at(0) },
    { id: 'TRK-309', node_id: 'TRK-309', label: 'Jules Banda', kind: 'personnel', role: 'WEARABLE', status: 'OFFLINE', evidence: 'UNKNOWN', observed_at: 0, zone_id: null, zone_code: '' },
    { id: 'GW-011', node_id: 'GW-011', label: 'East gateway', kind: 'device', role: 'GATEWAY', status: 'ONLINE', evidence: 'CONFIRMED', observed_at: 0, ...at(2) },
  ] : [
    { id: 'TRK-104', node_id: 'TRK-104', label: 'South survey kit', kind: 'asset', role: 'WEARABLE', status: 'ONLINE', evidence: 'CURRENT', observed_at: observed, ...at(3) },
  ];
  if (first && scenario === 'twin-pagination') {
    for (let index = 1; index <= 10; index++) {
      const id = `PAGE-${String(index).padStart(2, '0')}`;
      entities.push({ ...entities[0], id, node_id: id, label: `Survey tracker ${index}` });
    }
  }
  return {
    site, layout: { site: site.id, version: 3, updated_at: new Date(observed).toISOString(), geometry: {
      features: scenario === 'twin-no-layout' ? [{ points: [[0, 0], [0, 0], [10, 10]] }] : features,
    } },
    zones, entities: scenario === 'twin-empty' ? [] : entities, topology: [],
    topology_status: 'UNAVAILABLE_PENDING_VALIDATED_DIRECT_LINK_EVIDENCE',
  };
}
