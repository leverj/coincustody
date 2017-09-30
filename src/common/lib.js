const DEBUG = require('debug');
const path = require('path');

function Debug(filename) {
  return DEBUG("LEVERJ:" + path.basename(filename));
}

module.exports = {
  Debug,
};

