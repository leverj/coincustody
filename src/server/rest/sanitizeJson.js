module.exports = (function () {
  let allowed          = /[^0-9A-Za-z\.:_\s,/=+-]*/g;
  let sanitizer        = {};
  let defaultValidator = allowed;
  let validators       = {
    uuid       : /[^0-9a-z-]*/g,
    tx         : /[^0-9a-zA-Z]*/g,
    txs        : /[^0-9a-zA-Z]*/g,
    userid     : /[^0-9a-zA-Z]*/g,
    side       : { buy: true, sell: true },
    quantity   : {},
    price      : { NONE: true },
    status     : { open: true, closed: true, cancelled: true },
    orderType  : { MKT: true, LMT: true, SLM: true, STM: true, STP: true, TGT: true },
    targetPrice: { NONE: true },
    clientid   : /[^0-9a-z-]*/g,
    instrument : /[^0-9a-zA-Z]*/g,
    signature  : /[^0-9a-zA-Z\/\+=]*/g,
    publicApiKey : /[^0-9a-z\{\}:,"\\]*/ig
  };

  sanitizer.sanitizeMalicious = function (obj, validator) {
    if (obj === undefined || obj === null) {
      return obj
    } else if (typeof obj === 'string') {
      return sanitizer.sanitizeString(obj, validator)
    } else if (Array.isArray(obj)) {
      let newArray = [];
      for (let i = 0; i < obj.length; i++) {
        newArray.push(sanitizer.sanitizeMalicious(obj[i], validator))
      }
      return newArray
    } else if (typeof obj === 'object') {
      let keys = Object.keys(obj);
      for (let j = 0; j < keys.length; j++) {
        let key   = keys[j];
        validator = validators[key] || defaultValidator;
        obj[key]  = sanitizer.sanitizeMalicious(obj[key], validator)
      }
      return obj
    }
    return obj
  };

  sanitizer.sanitizeString = function (string, validator) {
    // string = string.substr(0,200)
    validator = validator || defaultValidator;
    if (validator instanceof RegExp) {
      return string.replace(validator, "") === string ? string : ""
    }
    return validator[string] ? string : "";
  };
  return sanitizer
})();