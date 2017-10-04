function getIp(req) {
  return req.header("x-forwarded-for") || req.ip
}

module.exports = {getIp};