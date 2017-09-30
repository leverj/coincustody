const DEBUG = require('debug');
const path = require('path');
function Debug(filename) {
  return DEBUG("CUSTODY:" + path.basename(filename));
}
module.exports = {
  Debug
};

