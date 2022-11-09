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

describe('visible', () => {
  it('waits for visible elements', async () => {
    const scrollable = element(by.id('scrollable'));
    const top = element(by.id('top'));

    await device.launchApp();

    await waitFor(scrollable)
      .toBeVisible()
      .withTimeout(100);
    await waitFor(top)
      .toBeVisible()
      .withTimeout(100);
  });

  it('waits for non visible elements', async () => {
    await device.launchApp();

    const middle = element(by.id('middle'));
    const bottom = element(by.id('bottom'));

    await waitFor(middle)
      .toBeNotVisible()
      .withTimeout(100);
    await waitFor(bottom)
      .toBeNotVisible()
      .withTimeout(100);
  });

  it('expects visible elements', async () => {
    await device.launchApp();

    const scrollable = element(by.id('scrollable'));
    const top = element(by.id('top'));

    await expect(scrollable).toBeVisible();
    await expect(top).toBeVisible();
  });

  it('expects non visible elements', async () => {
    await device.launchApp();
    const middle = element(by.id('middle'));
    const bottom = element(by.id('bottom'));

    await expect(middle).toBeNotVisible();
    await expect(bottom).toBeNotVisible();
  });
});

describe('exist', () => {
  it('matches for existing elements', async () => {
    await device.launchApp();

    const scrollable = element(by.id('scrollable'));
    const top = element(by.id('top'));
    const middle = element(by.id('middle'));
    const bottom = element(by.id('bottom'));

    await expect(scrollable).toExist();
    await expect(top).toExist();
    await expect(middle).toExist();
    await expect(bottom).toExist();
  });

  it('matches for non existing elements', async () => {
    await device.launchApp();

    await expect(element(by.id('RandomJunk959'))).toNotExist();
  });
});

afterAll(async () => {
  await server.destroy();
});
