import { h } from './dom';

export type ToastLevel = 'info' | 'warn' | 'error' | 'ok';

export function toast(message: string, level: ToastLevel = 'info', duration = 3600): void {
  const host = document.getElementById('toast-host')!;
  const el = h('div', { className: `toast toast-${level}`, textContent: message });
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

export function setAlarmBanner(level: 'red' | 'yellow' | 'none', text = ''): void {
  const banner = document.getElementById('alarm-banner') as HTMLElement;
  if (level === 'none') {
    banner.hidden = true;
    banner.className = '';
    return;
  }
  banner.hidden = false;
  banner.className = level === 'red' ? 'alarm-red' : 'alarm-yellow';
  document.getElementById('alarm-text')!.textContent = text;
}
