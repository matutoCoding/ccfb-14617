// 道路与地层：半透明层状体（OIT + 基坑裁剪），不透明地面网格

import * as THREE from 'three';
import { store, STRATA } from '../store';
import { makeOitMaterials, OitMaterialPair } from '../materials';
import { LAYER_OPAQUE } from '../oit';

export interface BuiltStrata {
  group: THREE.Group;
  transparents: { mesh: THREE.Mesh; pair: OitMaterialPair; layer: string }[];
  extent: { minX: number; maxX: number; minY: number; maxY: number };
}

export function siteExtent(margin = 25): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of store.entities) {
    minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
    minY = Math.min(minY, e.ay, e.by); maxY = Math.max(maxY, e.ay, e.by);
  }
  if (!Number.isFinite(minX)) { minX = -100; maxX = 100; minY = -100; maxY = 100; }
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

export function buildStrata(): BuiltStrata {
  const group = new THREE.Group();
  group.name = 'strata';
  const transparents: BuiltStrata['transparents'] = [];
  const ext = siteExtent();
  const cx = (ext.minX + ext.maxX) / 2, cy = (ext.minY + ext.maxY) / 2;
  const sx = ext.maxX - ext.minX, sy = ext.maxY - ext.minY;
  const base = store.baseElev;

  for (const layer of STRATA) {
    const top = base + layer.top, bottom = base + layer.bottom;
    const h = top - bottom;
    const geo = new THREE.BoxGeometry(sx, sy, h);
    const pair = makeOitMaterials({
      color: layer.color,
      alpha: layer.name === '路面结构层' ? 0.55 : 0.34,
      pitClip: true,
    });
    const mesh = new THREE.Mesh(geo, pair.accum);
    mesh.position.set(cx, cy, (top + bottom) / 2);
    mesh.userData = { kind: 'strata', layer: layer.name };
    group.add(mesh);
    transparents.push({ mesh, pair, layer: layer.name });
  }

  // 地面参考网格（不透明，z 基准面）
  const grid = new THREE.GridHelper(Math.max(sx, sy), Math.round(Math.max(sx, sy) / 10), 0x3a4350, 0x272e38);
  grid.rotation.x = Math.PI / 2; // GridHelper 默认 xz 平面 → 转到 xy 平面（z-up）
  grid.position.set(cx, cy, base + 0.27);
  (grid.material as THREE.Material).opacity = 0.5;
  (grid.material as THREE.Material).transparent = false;
  grid.layers.set(LAYER_OPAQUE);
  group.add(grid);

  return { group, transparents, extent: ext };
}
