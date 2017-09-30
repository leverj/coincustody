const express = require('express');

module.exports = (function () {
  let app     = express();
  let server  = getServer();

  function getServer() {
    return require('http').Server(app)
  }
  let indexhtml = "index.html";
  app.use(express.static('./dist/src/client', { maxAge: 31536000000 }));

  app.get(['/'], function (req, res) {

    return res.sendFile(indexhtml, {root:'./dist/src/client'})
  });

  server.listen(process.env.APP_PORT || '9010', process.env.APP_IP || '0.0.0.0')

})();