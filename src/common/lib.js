const DEBUG = require('debug');
const path = require('path');
const TimeUuid = require('cassandra-driver/lib/types/time-uuid');
const ethUtil = require('ethereumjs-util');
const abi = require('ethereumjs-abi');
let affirm = require('affirm.js');

function Debug(filename) {
  return DEBUG("CUSTODY:" + path.basename(filename));
}

function timeuuid(){
  return TimeUuid.now().toString();
}

function timeuuidToNumber(timeuuid){
  affirm(timeuuid, 'timeuuid not present');
  return ethUtil.bufferToHex(TimeUuid.fromString(timeuuid).buffer);
}

async function signOrder(order, signer, web3) {
  let types = order.types;
  let values = order.getOrderParams();
  let hash = abi.soliditySHA3(types, values);
  let sig = await web3.eth.sign(ethUtil.bufferToHex(hash), signer);
  let {v, r, s} = ethUtil.fromRpcSig(sig);
  return [v, ethUtil.bufferToHex(r), ethUtil.bufferToHex(s)];
}


module.exports = {
  Debug, timeuuid, timeuuidToNumber, signOrder
};

