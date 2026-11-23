// 管线数据页：CSV 导入（管点表+管段表）、坏行报告、测试数据生成、数据表浏览

import { importSurvey, pointsToCsv, segmentsToCsv } from '../csv';
import { generateTestData } from '../testdata';
import { store } from '../store';
import { ImportResult } from '../types';

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function readFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(f, 'utf-8');
  });
}

export function mountDataPage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side wide">
      <h2>普查成果导入</h2>
      <div class="btn-row">
        <button class="primary" id="btn-gen">生成测试数据并导入</button>
        <button id="btn-dl">下载测试CSV</button>
      </div>
      <div class="btn-row">
        <button id="btn-imp">导入CSV（管点表+管段表）</button>
        <button class="danger" id="btn-clear">清空数据</button>
      </div>
      <input type="file" id="file-pt" accept=".csv" hidden />
      <input type="file" id="file-sg" accept=".csv" hidden />
      <div class="hint">CSV 列：管点表＝点号,X,Y,地面高程,管点类型,附属物；管段表＝段号,起点号,终点号,类别,管径mm,材质,起点埋深,终点埋深,探测方法,精度等级,权属单位,断面,参数A,参数B</div>
      <div id="import-status"></div>
      <div id="issues" class="issue-list"></div>
      <h3>统计</h3>
      <div id="stats" class="hint"></div>
    </div>
    <div class="view-wrap" style="overflow:auto;padding:14px;">
      <div class="tabs">
        <button id="tab-pt" class="active">管点表</button>
        <button id="tab-sg">管段表</button>
      </div>
      <div class="table-wrap" id="tbl"></div>
    </div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  let lastResult: ImportResult | null = null;
  let tab: 'pt' | 'sg' = 'pt';

  function renderStats(): void {
    const inferred = store.segments.filter(s => s.depthInferred).length;
    $('#stats').innerHTML =
      `管点 <b>${store.points.length}</b> 个，管段 <b>${store.segments.length}</b> 段，` +
      `其中推测埋深 <b>${inferred}</b> 段；可建模管线实体 <b>${store.entities.length}</b> 段。`;
  }

  function renderIssues(r: ImportResult | null): void {
    const box = $('#issues');
    if (!r) { box.innerHTML = ''; return; }
    const errs = r.issues.filter(i => i.level === '错误');
    const warns = r.issues.filter(i => i.level === '警告');
    $('#import-status').innerHTML =
      `<span class="badge ${errs.length ? 'err' : 'ok'}">错误 ${errs.length}</span> ` +
      `<span class="badge ${warns.length ? 'warn' : 'ok'}">警告 ${warns.length}</span>`;
    box.innerHTML = r.issues.map(i =>
      `<div class="${i.level === '错误' ? 'err' : 'warn'}">[${i.level}] ${i.table}${i.row ? ` 第${i.row}行` : ''}：${i.message}</div>`,
    ).join('');
  }

  function renderTable(): void {
    const wrap = $('#tbl');
    if (tab === 'pt') {
      wrap.innerHTML = `<table class="data"><thead><tr>
        <th>点号</th><th>X</th><th>Y</th><th>地面高程</th><th>类型</th><th>附属物</th></tr></thead>
        <tbody>${store.points.map(p => `<tr>
          <td>${p.id}</td><td>${p.x.toFixed(3)}</td><td>${p.y.toFixed(3)}</td>
          <td>${p.groundElev.toFixed(3)}</td><td>${p.type}</td><td>${p.feature}</td>
        </tr>`).join('')}</tbody></table>`;
    } else {
      wrap.innerHTML = `<table class="data"><thead><tr>
        <th>段号</th><th>起点</th><th>终点</th><th>类别</th><th>管径</th><th>材质</th>
        <th>起点埋深</th><th>终点埋深</th><th>探测方法</th><th>精度</th><th>权属</th><th>断面</th></tr></thead>
        <tbody>${store.segments.map(s => `<tr class="${s.depthInferred ? 'inferred' : ''}">
          <td>${s.id}</td><td>${s.startId}</td><td>${s.endId}</td><td>${s.category}</td>
          <td>${s.diameter}</td><td>${s.material}</td>
          <td>${s.startDepth == null ? '—' : s.startDepth.toFixed(2) + (s.depthInferred ? '（推测）' : '')}</td>
          <td>${s.endDepth == null ? '—' : s.endDepth.toFixed(2) + (s.depthInferred ? '（推测）' : '')}</td>
          <td>${s.method}</td><td>${s.precision || '未填'}</td><td>${s.owner}</td>
          <td>${s.section === 'duct' ? `排管${s.ductRows}×${s.ductCols}` : s.section === 'box' ? `方沟${s.boxWidth}×${s.boxHeight}` : '圆管'}</td>
        </tr>`).join('')}</tbody></table>`;
    }
  }

  async function doImport(ptCsv: string, sgCsv: string): Promise<void> {
    const r = importSurvey(ptCsv, sgCsv);
    lastResult = r;
    await store.setSurveyData(r.points, r.segments);
    renderIssues(r);
    renderStats();
    renderTable();
  }

  $('#btn-gen').addEventListener('click', async () => {
    const t = generateTestData();
    await doImport(t.pointCsv, t.segmentCsv);
  });
  $('#btn-dl').addEventListener('click', () => {
    const t = generateTestData();
    download('管点表.csv', t.pointCsv);
    download('管段表.csv', t.segmentCsv);
  });
  $('#btn-imp').addEventListener('click', async () => {
    const fp = $('#file-pt') as HTMLInputElement;
    const fs = $('#file-sg') as HTMLInputElement;
    fp.value = ''; fs.value = '';
    fp.click();
    let ptCsv: string | null = null, sgCsv: string | null = null;
    fp.onchange = async () => { if (fp.files?.[0]) { ptCsv = await readFile(fp.files[0]); fs.click(); } };
    fs.onchange = async () => {
      if (fs.files?.[0]) {
        sgCsv = await readFile(fs.files[0]);
        if (ptCsv && sgCsv) await doImport(ptCsv, sgCsv);
      }
    };
  });
  $('#btn-clear').addEventListener('click', async () => {
    await store.clearSurvey();
    lastResult = null;
    renderIssues(null);
    $('#import-status').innerHTML = '';
    renderStats();
    renderTable();
  });
  $('#tab-pt').addEventListener('click', () => { tab = 'pt'; $('#tab-pt').classList.add('active'); $('#tab-sg').classList.remove('active'); renderTable(); });
  $('#tab-sg').addEventListener('click', () => { tab = 'sg'; $('#tab-sg').classList.add('active'); $('#tab-pt').classList.remove('active'); renderTable(); });

  const unsub = store.subscribe(() => { renderStats(); renderTable(); });
  renderStats();
  renderTable();
  return () => { unsub(); void lastResult; };
}
