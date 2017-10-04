const _ = require('lodash');
const express = require('express');
const config = require("config");
const bodyParser = require('body-parser');
const custody = require('../../../build/contracts/Custody.json').abi;
const erc20 = require('../../../build/contracts/Token.json').abi;

module.exports = (async function () {


  function nop(req, res, next) {
    return next()
  }

  async function getConfig(req, res, next) {
    return res.send({
      common: config.common,
      abi: {custody, erc20}
    });
  }

  let app = express();
  app.use(bodyParser.json());
  app.get('/config', api(getConfig))

  function api(method) {
    return (async function () {
      let res = arguments[1];
      try {
        await method.apply(this, arguments)
      } catch (e) {
        console.log('FAIL', method.name, e);
        res.status(e.statusCode || 500).send({error: e.message})
      }
    })
  }

  return app
})().catch(console.error);
