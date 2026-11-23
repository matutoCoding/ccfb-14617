// 应用入口：导航 + hash 路由

import './styles.css';
import { store } from './store';
import { mountDataPage } from './pages/dataPage';
import { mountStrataPage } from './pages/strataPage';
import { mountBrowsePage } from './pages/browsePage';
import { mountExcavPage } from './pages/excavPage';
import { mountMachinePage } from './pages/machinePage';
import { mountBriefPage } from './pages/briefPage';

type MountFn = (el: HTMLElement) => () => void;

const ROUTES: { hash: string; label: string; mount: MountFn }[] = [
  { hash: 'data', label: '管线数据', mount: mountDataPage },
  { hash: 'strata', label: '道路地层', mount: mountStrataPage },
  { hash: 'browse', label: '透视浏览', mount: mountBrowsePage },
  { hash: 'excav', label: '开挖方案', mount: mountExcavPage },
  { hash: 'machine', label: '挖机作业', mount: mountMachinePage },
  { hash: 'brief', label: '施工交底', mount: mountBriefPage },
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="topbar">
    <span class="logo">地下管线透视与开挖防护</span>
    ${ROUTES.map(r => `<a href="#/${r.hash}" data-hash="${r.hash}">${r.label}</a>`).join('')}
  </header>
  <main><div id="page" class="page"></div></main>
`;

const pageEl = document.getElementById('page')!;
let unmount: (() => void) | null = null;

function route(): void {
  const hash = location.hash.replace(/^#\//, '') || 'data';
  const r = ROUTES.find(x => x.hash === hash) ?? ROUTES[0];
  document.querySelectorAll('header.topbar a').forEach(a => {
    a.classList.toggle('active', (a as HTMLAnchorElement).dataset.hash === r.hash);
  });
  unmount?.();
  pageEl.innerHTML = '';
  unmount = r.mount(pageEl);
}

window.addEventListener('hashchange', route);

store.load().then(() => {
  route();
});
