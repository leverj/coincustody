const DEBUG = require('debug');
const path = require('path');

function Debug(filename) {
  return DEBUG("CUSTODY:" + path.basename(filename));
}


async function sendToken(count, user, contract, token) {
  await token.approve(contract.address, count, {from: user});
  await contract.depositToken(count, {from: user});
}

function forceMine(blockToMine) {
  return new Promise(async (resolve, reject) => {
    if (!BN.isBN(blockToMine)) {
      reject('Supplied block number must be a BN.');
    }
    const blockNumber = await ethQuery.blockNumber();
    if (blockNumber.lt(blockToMine)) {
      ethRPC.sendAsync({method: 'evm_mine'}, (err) => {
        if (err !== undefined && err !== null) {
          reject(err);
        }
        resolve(forceMine(blockToMine));
      });
    } else {
      resolve();
    }
  });
}


async function balance(address, token) {
  return (await token.balanceOf(address)).toNumber();
}


module.exports = {
  Debug, sendToken, forceMine, balance
};