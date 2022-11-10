const utils = require('./utils');
const detox = require('detox');

let server;

beforeAll(async () => {
  server = await utils.startServer(`
    <style>
    body { overflow: hidden;display:flex; }
    </style>
    <div data-testid="scrollable" style="flex: 1;overflow:scroll">
      <div data-testid="top">my top</div>
      <div data-testid="middle" aria-label="accessibility is important">my middle</div>
      <div data-testid="bottom">my bottom</div>
    </div>
    `);
  await device.launchApp();
});

describe('id', () => {
  it('expects toHaveId', async () => {
    await expect(element(by.id('top'))).toHaveId('top');
  });

  it('matches by.id', async () => {
    await expect(element(by.id('top'))).toExist();
  });
});

describe('text', () => {
  it('expects toHaveText', async () => {
    await expect(element(by.id('top'))).toHaveText('my top');
  });

  it('matches by.text', async () => {
    await expect(element(by.text('my top'))).toExist();
  });
});

describe('label', () => {
  it('expects label', async () => {
    await expect(element(by.id('middle'))).toHaveLabel('accessibility is important');
  });

  it('matches by label', async () => {
    await expect(element(by.label('accessibility is important'))).toExist();
  });
});

afterAll(async () => {
  await server.destroy();
});
