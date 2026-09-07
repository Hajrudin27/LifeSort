/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { isWriteRoute, moduleForPath } from '@/core/modules/moduleRoutes';

/**
 * Kill switchen virker kun, hvis hver eneste rute kan slås op i det rigtige
 * modul — også dem man når via et deep link. Testen kører præfiks-kortet mod
 * ALLE ruter i repoet og sammenligner med docs/app-inventory.md §2, så en ny
 * rute ikke kan ende med at høre til et andet modul, end inventaret siger.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'app-inventory.md'), 'utf8');

function inventoryRoutes(): { url: string; file: string; module: string }[] {
  const start = INVENTORY.indexOf('<!-- inventory:routes:start -->');
  const end = INVENTORY.indexOf('<!-- inventory:routes:end -->');
  return INVENTORY.slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.replace(/`/g, '').trim()))
    .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
    .slice(1)
    .map((cells) => ({ url: cells[0], file: cells[1], module: cells[2] }));
}

describe('moduleForPath', () => {
  const routes = inventoryRoutes();

  it('har ruter at kontrollere', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('slår hver rute op i det modul inventaret siger', () => {
    const wrong = routes
      // _layout, +html og +not-found er ikke sider man navigerer til.
      .filter((route) => !/(_layout|\+html|\+not-found)/.test(route.file))
      .map((route) => ({ ...route, resolved: moduleForPath(route.url) }))
      .filter((route) => route.resolved !== route.module)
      .map((route) => `${route.url} → ${route.resolved}, men inventaret siger ${route.module}`);

    expect(wrong).toEqual([]);
  });

  it('behandler dynamiske segmenter som en del af modulet', () => {
    expect(moduleForPath('/travel/abc-123')).toBe('travel');
    expect(moduleForPath('/travel/abc-123/expenses/new')).toBe('travel');
    expect(moduleForPath('/cycle/health-info/xyz')).toBe('cycle');
  });

  it('lader sig ikke narre af trailing slash eller query', () => {
    expect(moduleForPath('/warranties/')).toBe('warranties');
    expect(moduleForPath('/warranties?from=home')).toBe('warranties');
  });

  it('forveksler ikke et præfiks med et andet modul', () => {
    // "/food" må ikke fange "/foodie", og "/todos" ikke "/todos-archive".
    expect(moduleForPath('/foodie')).toBe('core-shell');
    expect(moduleForPath('/todos-archive')).toBe('core-shell');
  });

  it('falder tilbage til skallen for ukendte stier', () => {
    // Skallen kan ikke slås fra, så en ukendt sti kan aldrig blive spærret.
    expect(moduleForPath('/')).toBe('core-shell');
    expect(moduleForPath('/noget-der-ikke-findes')).toBe('core-shell');
    expect(moduleForPath('')).toBe('core-shell');
  });
});

describe('isWriteRoute — hvad maintenance sætter på pause', () => {
  const routes = inventoryRoutes();

  it('genkender hver opret-skærm i repoet', () => {
    // Konventionen er `new.tsx`. Er der en, den ikke fanger, ville maintenance
    // stille og roligt lade brugeren oprette videre i et lukket modul.
    const missed = routes
      .filter((route) => route.file.endsWith('/new.tsx'))
      .filter((route) => !isWriteRoute(route.url));

    expect(missed.map((route) => route.url)).toEqual([]);
    expect(routes.filter((route) => route.file.endsWith('/new.tsx')).length).toBeGreaterThan(10);
  });

  it('genkender rette-skærmene', () => {
    const editRoutes = routes.filter((route) => route.file.includes('/edit/'));
    expect(editRoutes.length).toBeGreaterThan(0);
    for (const route of editRoutes) expect(isWriteRoute(route.url)).toBe(true);
  });

  it('spærrer ikke almindelige læseskærme', () => {
    for (const url of ['/', '/warranties', '/travel/abc-123', '/cycle/history', '/expenses']) {
      expect(isWriteRoute(url)).toBe(false);
    }
  });

  it('forveksler ikke et ord med et segment', () => {
    // "/news" eller "/renewal" er ikke opret-skærme.
    expect(isWriteRoute('/news')).toBe(false);
    expect(isWriteRoute('/food/renewal')).toBe(false);
  });
});
