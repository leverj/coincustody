const DEBUG = require('debug');
const path = require('path');
let bluebird = require('bluebird');
const expect = require("expect.js");
const fs = require('fs');
const BN = require('bn.js');
const HttpProvider = require('ethjs-provider-http');
const EthRPC = require('ethjs-rpc');
const EthQuery = require('ethjs-query');
const Web3 = require('web3');
const abi = require('ethereumjs-abi');
const ethUtil = require('ethereumjs-util');

const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'));
const ethQuery = new EthQuery(new HttpProvider('http://localhost:8545'));
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));


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
      blockToMine = new BN(blockToMine)
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