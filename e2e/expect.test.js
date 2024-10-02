const { jestExpect } = require('@jest/expect');
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
  await device.launchApp({ url: `http://localhost:${server.address().port}` });
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

describe('getAttributes', () => {
  // https://wix.github.io/Detox/docs/api/actions/#getattributes
  it('returns standard attributes', async () => {
    const attrs = await element(by.id('middle')).getAttributes();
    jestExpect(attrs).toEqual({
      text: 'my middle',
      label: 'accessibility is important',
      placeholder: null,
      enabled: true,
      identifier: 'middle',
      visible: true,
      value: null,
      frame: {
        x: 8,
        y: 26.5,
        width: 359,
        height: 18.5,
        top: 26.5,
        right: 367,
        bottom: 45,
        left: 8,
      },
    });
  });
});

afterAll(async () => {
  await server.destroy();
});
