import './styles.css';
import { SceneContext } from './core/sceneContext';
import { store } from './state/store';
import { h } from './ui/dom';
import { setAlarmBanner, toast } from './ui/toast';
import { renderPipelinePage } from './pages/pipelinePage';
import { renderTerrainPage } from './pages/terrainPage';
import { renderXrayPage } from './pages/xrayPage';
import { renderExcavatorPage, disposeExcavatorPage } from './pages/excavatorPage';
import { renderExcavationPlanPage } from './pages/excavationPage';
import { renderSectionPage } from './pages/sectionPage';
import { renderBriefingPage } from './pages/briefingPage';

type PageId = 'pipeline' | 'terrain' | 'xray' | 'excavation-plan' | 'excavator' | 'section' | 'briefing';

const NAV: { id: PageId; name: string; icon: string }[] = [
  { id: 'pipeline', name: '管线数据', icon: '▦' },
  { id: 'terrain', name: '道路地层', icon: '▤' },
  { id: 'xray', name: '透视浏览', icon: '◉' },
  { id: 'excavation-plan', name: '开挖方案', icon: '▢' },
  { id: 'excavator', name: '挖机作业', icon: '⛏' },
  { id: 'section', name: '横断面', icon: '⇋' },
  { id: 'briefing', name: '施工交底', icon: '📋' }
];

let ctx: SceneContext;
let currentPage: PageId | null = null;

function renderNav(active: PageId): void {
  const nav = document.getElementById('nav-links')!;
  nav.innerHTML = '';
  for (const item of NAV) {
    const link = h('a', {
      className: `nav-link ${item.id === active ? 'active' : ''}`,
      href: `#${item.id}`,
      onClick: (e: Event) => {
        e.preventDefault();
        location.hash = item.id;
      }
    }, h('span', { className: 'nav-icon', textContent: item.icon }), h('span', { textContent: item.name }));
    nav.appendChild(link);
  }
}

function teardownPage(): void {
  setAlarmBanner('none');
  disposeExcavatorPage(ctx);
  ctx.onFrame = null;
}

function route(): void {
  const id = (location.hash.replace('#', '') || 'pipeline') as PageId;
  if (!NAV.some((n) => n.id === id)) {
    location.hash = 'pipeline';
    return;
  }
  if (id === currentPage) return;
  teardownPage();
  currentPage = id;
  renderNav(id);
  const root = document.getElementById('page-root')!;
  root.innerHTML = '';
  switch (id) {
    case 'pipeline':
      renderPipelinePage(root);
      break;
    case 'terrain':
      renderTerrainPage(root, ctx);
      break;
    case 'xray':
      renderXrayPage(root, ctx);
      break;
    case 'excavation-plan':
      renderExcavationPlanPage(root, ctx);
      break;
    case 'excavator':
      renderExcavatorPage(root, ctx);
      break;
    case 'section':
      renderSectionPage(root, ctx);
      break;
    case 'briefing':
      renderBriefingPage(root, ctx);
      break;
  }
}

async function bootstrap(): Promise<void> {
  const host = document.getElementById('gl-host')!;
  ctx = new SceneContext(host);
  await store.init();
  ctx.loadPipeline(store.points, store.segments);
  toast(`数据已载入: ${store.points.length} 个管点 / ${store.segments.length} 段, 校验问题 ${store.issues.length} 条`, 'ok', 5000);

  store.subscribe(() => {
    ctx.loadPipeline(store.points, store.segments);
    if (store.activePlan) ctx.setPit(store.activePlan);
  });

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = 'pipeline';
  route();
}

bootstrap().catch((err) => {
  console.error(err);
  toast('初始化失败: ' + (err as Error).message, 'error', 10000);
});
