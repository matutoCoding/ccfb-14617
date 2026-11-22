// 路面与三层地层(杂填土/粉质黏土/砂层), 全部走 WBOIT 半透明
import * as THREE from 'three';
import { STRATA } from '../domain/constants';
import type { Wboit } from './wboit';

export interface Terrain {
  group: THREE.Group;
  setRoadOpacity: (v: number) => void;
  setStrataOpacity: (v: number) => void;
}

export function buildTerrain(wboit: Wboit, size = 170): Terrain {
  const group = new THREE.Group();
  group.name = 'terrain';

  // 路面(沥青薄层)
  const roadMat = wboit.registerStandard(
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.95, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  const road = new THREE.Mesh(new THREE.PlaneGeometry(size, size), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0;
  road.renderOrder = 10;
  group.add(road);

  // 道路标线(不透明, 画在路面上方)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xfff59d });
  for (const off of [-20, 20]) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.25), lineMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.01, off);
    group.add(mark);
  }

  // 三个地层盒(顶到底)
  let top = 0;
  const strataMats: THREE.MeshStandardMaterial[] = [];
  for (const layer of STRATA) {
    const thickness = layer.bottomDepth - top;
    const mat = wboit.registerStandard(
      new THREE.MeshStandardMaterial({
        color: layer.color,
        roughness: 1,
        transparent: true,
        opacity: layer.opacity,
        side: THREE.DoubleSide
      })
    );
    strataMats.push(mat);
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, thickness, size), mat);
    box.position.set(0, -(top + thickness / 2), 0);
    box.renderOrder = 20;
    group.add(box);
    top = layer.bottomDepth;
  }

  return {
    group,
    setRoadOpacity: (v) => (roadMat.opacity = v),
    setStrataOpacity: (v) => strataMats.forEach((m, i) => (m.opacity = v * (STRATA[i].opacity / 0.24)))
  };
}
