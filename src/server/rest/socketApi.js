const socketio          = require('socket.io');
module.exports = (async function () {
  let io;
  let socketApi      = {};

  function onConnection(socket) {
    console.log('################# socket to client connected');
  }

  socketApi.connect = function (server) {
    io = socketio(server);
    io.on('connection', onConnection)
  };

  return socketApi
})();
