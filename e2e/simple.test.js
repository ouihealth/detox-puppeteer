const utils = require('./utils');
const detox = require('detox');

let server;

describe('simple', () => {
  beforeAll(async () => {
    server = await utils.startServer();
  });

  it('can execute the driver', async () => {
    await device.launchApp();

    await expect(element(by.id('mytestid'))).toBeVisible();
    await expect(element(by.id('mytestid2'))).toNotExist();
  });

  it('can execute the driver 2', async () => {
    await device.launchApp();

    await expect(element(by.id('mytestid'))).toBeVisible();
    await expect(element(by.id('mytestid2'))).toNotExist();
  });

  afterAll(async () => {
    await server.destroy();
  });
});
