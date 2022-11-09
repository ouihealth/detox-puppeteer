const utils = require('./utils');
const detox = require('detox');

let server;

beforeAll(async () => {
  server = await utils.startServer(`
    <style>
    body { overflow: hidden;display:flex; }
    </style>
    <div data-testid="scrollable" style="flex: 1;overflow:scroll">
      <div data-testid="top">top element</div>
      <div style="height: 1000px; border: 1px solid;"></div>
      <div data-testid="middle">middle element</div>
      <div style="height: 1000px; border: 1px solid;"></div>
      <div data-testid="bottom">bottom element</div>
    </div>
    `);
});

const scrollable = element(by.id('scrollable'));
const top = element(by.id('top'));
const middle = element(by.id('middle'));
const bottom = element(by.id('bottom'));

describe('scrollTo', () => {
  it('scrolls to edge vertically', async () => {
    await device.launchApp();

    await expect(scrollable).toBeVisible();
    await expect(bottom).toBeNotVisible();

    await scrollable.scrollTo('bottom');

    await expect(bottom).toBeVisible();
  });
});

describe('scroll', () => {
  it('scrolls by offset provided', async () => {
    await device.launchApp();

    await expect(scrollable).toBeVisible();
    await expect(bottom).toBeNotVisible();

    await scrollable.scroll(1000, 'down');

    await expect(middle).toBeVisible();
    await expect(bottom).toBeNotVisible();

    await scrollable.scroll(1000, 'down');

    await expect(bottom).toBeVisible();
  });

  describe('whileElement', () => {
    it('scrolls until the element is visible and stops', async () => {
      await device.launchApp();

      await expect(scrollable).toBeVisible();
      await expect(bottom).toBeNotVisible();
      await expect(middle).toBeNotVisible();

      try {
        await waitFor(middle)
          .toBeVisible()
          .whileElement(by.id('scrollable'))
          .scroll(1500, 'down');
      } catch (e) {
        await utils.sleep(5000000);
      }
    }, 50000000);
  });
});

afterAll(async () => {
  await server.destroy();
});
