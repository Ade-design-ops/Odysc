import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBuildingFootprint, selectBuildingHighlight } from '../../client/src/map-footprint.js';

const square = (left: number, bottom: number, right: number, top: number) => [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]];
const polygon = (coordinates: number[][][], id?: number) => ({ type: 'Feature', id, properties: { render_height: 12, render_min_height: 2 }, geometry: { type: 'Polygon', coordinates } });

test('a provider MultiPolygon grouping 34 buildings highlights only containing component 15', () => {
  // The live TCC provider feature groups 34 separate roofs under one ID.
  const components = Array.from({ length: 34 }, (_, index) => [square(index * 2, 0, index * 2 + 1, 1)]);
  const source = { type: 'Feature', id: 60954680, properties: { render_height: 14, render_min_height: 0 }, geometry: { type: 'MultiPolygon', coordinates: components } };
  const result = selectBuildingFootprint([source], [30.5, 0.5]);
  assert.ok(result);
  assert.equal(result.geometry.type, 'Polygon');
  assert.deepEqual(result.geometry.coordinates, components[15]);
  assert.equal(result.geometry.coordinates.length, 1);
  assert.equal('id' in result, false);
  assert.deepEqual(result.properties, { render_height: 14, render_min_height: 0 });
  result.geometry.coordinates[0]![0]![0] = 99;
  result.properties.render_height = 99;
  assert.equal(source.geometry.coordinates[15]![0]![0]![0], 30, 'returned geometry does not mutate the source');
  assert.equal(source.properties.render_height, 14, 'returned properties do not mutate the source');
});

test('an occluding first hit and unrelated duplicate IDs cannot select a neighboring building', () => {
  const neighbor = polygon([square(3, 0, 4, 1)], 7);
  neighbor.properties.render_height = 100;
  const target = polygon([square(0, 0, 1, 1)], 7);
  const withoutId = polygon([square(0, 0, 1, 1)]);
  assert.deepEqual(selectBuildingFootprint([neighbor, target], [0.5, 0.5])?.geometry.coordinates, target.geometry.coordinates);
  assert.deepEqual(selectBuildingFootprint([target, neighbor], [0.5, 0.5])?.geometry.coordinates, target.geometry.coordinates);
  assert.deepEqual(selectBuildingFootprint([neighbor, withoutId], [0.5, 0.5])?.geometry.coordinates, target.geometry.coordinates);
  assert.equal(selectBuildingFootprint([neighbor], [0.5, 0.5]), null, 'no nearest-building fallback');
});

test('courtyard interiors and their boundaries do not count as a roof, while hole rings are preserved', () => {
  const courtyard = [square(0, 0, 10, 10), square(4, 4, 6, 6)];
  const source = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [courtyard, [square(20, 0, 21, 1)]] } };
  assert.equal(selectBuildingFootprint([source], [5, 5]), null);
  assert.equal(selectBuildingFootprint([source], [4, 5]), null);
  assert.deepEqual(selectBuildingFootprint([source], [2, 2])?.geometry.coordinates, courtyard);
  assert.deepEqual(selectBuildingFootprint([source], [0, 2])?.geometry.coordinates, courtyard, 'an outer edge remains part of its building');
});

test('duplicate and tile-clipped copies prefer the largest containing footprint without merging neighbors', () => {
  const full = polygon([square(0, 0, 4, 4)]);
  const clipped = polygon([square(0, 0, 2, 4)]);
  const neighbor = polygon([square(4, 0, 8, 4)]);
  const candidates = [clipped, full, structuredClone(full), neighbor];
  assert.deepEqual(selectBuildingFootprint(candidates, [1, 2])?.geometry.coordinates, full.geometry.coordinates);
  assert.deepEqual(selectBuildingFootprint([...candidates].reverse(), [1, 2]), selectBuildingFootprint(candidates, [1, 2]), 'query order does not change selection');
  assert.deepEqual(selectBuildingFootprint([clipped, neighbor], [1, 2])?.geometry.coordinates, clipped.geometry.coordinates, 'missing fragments are not invented or joined to another roof');
});

test('malformed components are skipped and output height properties remain finite numbers', () => {
  const invalid = [
    null, {}, { geometry: null }, { geometry: { type: 'Point', coordinates: [0, 0] } },
    polygon([]), polygon([[[0, 0], [1, 0], [1, 1]]]),
    polygon([[[0, 0], [1, 0], [Number.NaN, 1], [0, 0]]]),
    polygon([[[0, 0], [1, 0], [2, 0], [0, 0]]]),
  ];
  assert.equal(selectBuildingFootprint(invalid, [0.5, 0.5]), null);
  const valid = polygon([square(0, 0, 1, 1)]);
  valid.properties.render_height = Number.POSITIVE_INFINITY;
  valid.properties.render_min_height = Number.NaN;
  const mixed = { geometry: { type: 'MultiPolygon', coordinates: [null, valid.geometry.coordinates] }, properties: valid.properties };
  assert.deepEqual(selectBuildingFootprint([...invalid, mixed], [0.5, 0.5])?.properties, { render_height: 8, render_min_height: 0 });
  assert.equal(selectBuildingFootprint([valid], [Number.NaN, 0]), null);
});

test('whole-building replacement preserves all 33 nonselected roofs from a grouped feature', () => {
  const components = Array.from({ length: 34 }, (_, index) => [square(index * 2, 0, index * 2 + 1, 1)]);
  const source = { type: 'Feature', id: 60954680, properties: { render_height: 14, render_min_height: 3 }, geometry: { type: 'MultiPolygon', coordinates: components } };
  const result = selectBuildingHighlight([source], [30.5, 0.5]);
  assert.ok(result);
  assert.deepEqual(result.excludedIds, [60954680]);
  assert.deepEqual(result.footprint.geometry.coordinates, components[15]);
  assert.equal(result.neutralRemainder.features.length, 33);
  const neutralShapes = new Set(result.neutralRemainder.features.map(feature => JSON.stringify(feature.geometry.coordinates)));
  for (let index = 0; index < components.length; index += 1) {
    assert.equal(neutralShapes.has(JSON.stringify(components[index])), index !== 15);
  }
  assert.ok(result.neutralRemainder.features.every(feature => feature.properties.render_height === 14 && feature.properties.render_min_height === 3));
  const reversed = { ...source, geometry: { type: 'MultiPolygon', coordinates: [...components].reverse() } };
  assert.deepEqual(selectBuildingHighlight([reversed, source, source], [30.5, 0.5]), result, 'duplicates and component/query order cannot change the replacement');
  result.neutralRemainder.features[0]!.geometry.coordinates[0]![0]![0] = 99;
  assert.equal(source.geometry.coordinates.some(component => component[0]![0]![0] === 99), false, 'neutral geometry is cloned');
});

test('unrelated loaded groups sharing an excluded ID retain their own height properties', () => {
  const target = polygon([square(0, 0, 1, 1)], 7);
  const neighbor = polygon([square(3, 0, 4, 1)], 7);
  neighbor.properties = { render_height: 70, render_min_height: 10 };
  const unaffected = polygon([square(6, 0, 7, 1)], 8);
  const stringId = { ...polygon([square(9, 0, 10, 1)]), id: '7' };
  const result = selectBuildingHighlight([target, neighbor, unaffected, stringId], [0.5, 0.5]);
  assert.ok(result);
  assert.deepEqual(result.excludedIds, [7], 'numeric and string IDs are distinct');
  assert.equal(result.neutralRemainder.features.length, 1);
  assert.deepEqual(result.neutralRemainder.features[0]!.geometry.coordinates, neighbor.geometry.coordinates);
  assert.deepEqual(result.neutralRemainder.features[0]!.properties, { render_height: 70, render_min_height: 10 });
});

test('covered target fragments are removed without merging neighbors or dropping courtyard buildings', () => {
  const target = polygon([square(0, 0, 10, 10), square(4, 4, 6, 6)], 9);
  const targetClip = polygon([square(7, 0, 10, 4)], 9);
  const courtyardBuilding = polygon([square(4, 4, 6, 6)], 9);
  const neighbor = polygon([square(10, 0, 14, 4)], 9);
  const result = selectBuildingHighlight([targetClip, target, courtyardBuilding, neighbor, structuredClone(target)], [2, 2]);
  assert.ok(result);
  assert.equal(result.neutralRemainder.features.length, 2);
  const neutralShapes = result.neutralRemainder.features.map(feature => JSON.stringify(feature.geometry.coordinates));
  assert.ok(neutralShapes.includes(JSON.stringify(courtyardBuilding.geometry.coordinates)));
  assert.ok(neutralShapes.includes(JSON.stringify(neighbor.geometry.coordinates)));
  assert.equal(neutralShapes.includes(JSON.stringify(targetClip.geometry.coordinates)), false);
  assert.deepEqual(selectBuildingHighlight([neighbor, target, targetClip, courtyardBuilding], [2, 2]), result);
});

test('replacement fails closed for missing target IDs or an excluded group that cannot be reconstructed', () => {
  const target = polygon([square(0, 0, 1, 1)]);
  assert.equal(selectBuildingHighlight([target], [0.5, 0.5]), null);
  const withZeroId = { ...target, id: 0 };
  assert.deepEqual(selectBuildingHighlight([withZeroId], [0.5, 0.5])?.excludedIds, [0]);
  const malformedSameGroup = { ...withZeroId, geometry: { type: 'MultiPolygon', coordinates: [null] } };
  assert.equal(selectBuildingHighlight([withZeroId, malformedSameGroup], [0.5, 0.5]), null);
  assert.equal(selectBuildingHighlight([withZeroId, { ...withZeroId, id: undefined }], [0.5, 0.5]), null);
});
