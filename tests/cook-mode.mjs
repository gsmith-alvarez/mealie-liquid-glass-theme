import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Run only against a disposable Mealie instance with this theme injected.
const base = process.env.MEALIE_TEST_URL?.replace(/\/$/, '');
const username = process.env.MEALIE_TEST_USERNAME;
const password = process.env.MEALIE_TEST_PASSWORD;
const executablePath = process.env.CHROMIUM_PATH;

test('cook mode exit remains clickable on desktop and mobile', { skip: !base }, async () => {
  assert.ok(username && password && executablePath, 'Set MEALIE_TEST_USERNAME, MEALIE_TEST_PASSWORD, and CHROMIUM_PATH');
  const { default: puppeteer } = await import('puppeteer-core');
  const tokenResponse = await fetch(`${base}/api/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  assert.ok(tokenResponse.ok, `Login API returned ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  const recipes = [];
  let browser;
  try {
    for (const linked of [false, true]) {
      const slug = await api('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Cook mode test ${randomUUID()}` }),
      });
      recipes.push(slug);
      const recipe = await api(`/api/recipes/${slug}`);
      const referenceId = randomUUID();
      recipe.recipeIngredient = [{ note: 'One tomato', referenceId }];
      recipe.recipeInstructions = [{
        text: 'Prepare and serve.',
        ingredientReferences: linked ? [{ referenceId }] : [],
      }];
      await api(`/api/recipes/${slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(recipe),
      });
    }

    const css = await readFile(new URL('../liquid-glass.css', import.meta.url), 'utf8');
    browser = await puppeteer.launch({
      executablePath,
      args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
    });
    for (const width of [1200, 390]) {
      const page = await browser.newPage();
      let stylesheetSeen = false;
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/liquid-glass.css') {
          stylesheetSeen = true;
          return request.respond({ status: 200, contentType: 'text/css', body: css });
        }
        return request.continue();
      });
      await page.setViewport({ width, height: 850, hasTouch: width < 600, isMobile: width < 600 });
      await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
      if (await page.$('#username')) {
        for (const [selector, value] of [['#username', username], ['#password', password]]) {
          await page.focus(selector);
          await page.keyboard.down('Control');
          await page.keyboard.press('KeyA');
          await page.keyboard.up('Control');
          await page.type(selector, value);
        }
        await page.click('button[type=submit]');
        await page.waitForFunction(() => !location.pathname.startsWith('/login'));
      }
      for (const slug of recipes) {
        await page.goto(`${base}/recipe/${slug}`, { waitUntil: 'networkidle2' });
        assert.ok(stylesheetSeen, 'The disposable Mealie instance must load liquid-glass.css');
        let entry;
        for (const button of await page.$$('button')) {
          if ((await button.evaluate(element => element.innerText)).includes('Cook Mode')) {
            entry = button;
            break;
          }
        }
        assert.ok(entry, 'Cook Mode entry button was not found');
        await entry.click();
        const selector = 'button[style*="position: fixed"]';
        await page.waitForSelector(selector, { visible: true });
        const exit = await page.$(selector);
        const isHitTarget = await exit.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
        assert.ok(isHitTarget, `Exit button is covered at ${width}px for ${slug}`);
        if (width < 600) await exit.tap();
        else await exit.click();
        await page.waitForSelector(selector, { hidden: true });
        await page.waitForFunction(() => [...document.querySelectorAll('button')]
          .some(button => button.innerText.includes('Cook Mode') && button.getClientRects().length));
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    for (const slug of recipes) await api(`/api/recipes/${slug}`, { method: 'DELETE' });
  }
});
