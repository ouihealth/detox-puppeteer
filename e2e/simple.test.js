const http = require('http');
const detox = require('detox');

let server;

// https://gajus.medium.com/how-to-terminate-a-http-server-in-node-js-d374f8b8c17f
function enableDestroy(server) {
  var connections = {};

  server.on('connection', function(conn) {
    var key = conn.remoteAddress + ':' + conn.remotePort;
    connections[key] = conn;
    conn.on('close', function() {
      delete connections[key];
    });
  });

  server.destroy = function(cb) {
    server.close(cb);
    for (var key in connections) connections[key].destroy();
  };
}

describe('simple', () => {
  beforeAll(async () => {
    return new Promise((resolve) => {
      server = http
        .createServer(function(_req, res) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<div data-testid="mytestid">hello world</div>`);
        })
        .listen(8889, () => {
          resolve();
        });
      enableDestroy(server);
    });
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
    return new Promise((res) => {
      server.destroy(res);
    });
  });
});
