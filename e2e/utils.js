const http = require('http');

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

  server.destroy = function() {
    return new Promise((res) => {
      server.close(res);
      for (var key in connections) connections[key].destroy();
    });
  };
}

async function startServer(content) {
  return new Promise((resolve) => {
    const server = http
      .createServer(function(_req, res) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content || `<div data-testid="mytestid">hello world</div>`);
      })
      .listen(0, () => {
        resolve(server);
      });
    enableDestroy(server);
  });
}

function sleep(time) {
  return new Promise((res) => setTimeout(res, time));
}

module.exports = {
  startServer,
  sleep,
};
