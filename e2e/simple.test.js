const http = require('http');
const detox = require('detox');

let server;

describe('simple', () => {
  beforeAll(async () => {
    await detox.init();

    return new Promise((resolve) => {
      server = http
        .createServer(function(_req, res) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<div data-testid="mytestid">hello world</div>`);
        })
        .listen(8889, () => {
          resolve();
        });
    });
  });

  it('can execute the driver', async () => {
    await device.launchApp({
      newInstance: true,
    });

    await expect(element(by.id('mytestid'))).toBeVisible();
    await expect(element(by.id('mytestid2'))).toNotExist();
  });

  afterAll(async () => {
    await detox.cleanup();
    return new Promise((res) => {
      server.close(res);
    });
  });
});
