const StandardToken = artifacts.require("./HumanStandardToken.sol");
const Custody = artifacts.require("./Custody.sol");

let bluebird = require('bluebird');
const expect = require("expect.js");
const fs = require('fs');
const BN = require('bn.js');
const HttpProvider = require('ethjs-provider-http');
const EthRPC = require('ethjs-rpc');
const EthQuery = require('ethjs-query');
const Web3 = require('web3');
const lib = require('../lib');
const debug = lib.Debug(__filename);
const abi = require('ethereumjs-abi');
const ethUtil = require('ethereumjs-util');
const uuid = require('uuid/v4');

const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'));
const ethQuery = new EthQuery(new HttpProvider('http://localhost:8545'));
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

contract('deposit', function (accounts) {
  let token, custody;
  let user1 = accounts[1];
  let user2 = accounts[2];

  before(async function () {
    [token, custody] = await setup(accounts);

  });

  it('user is able to send ether and tokens to custody contract', async function () {
    await lib.sendToken(100, user1, custody, token);
    // await custody.depositToken(100, {from: user1});
    await web3.eth.sendTransaction({from: user1, to: custody.address, value: 10000000});
    expect(await lib.balance(user1, token)).to.be.eql(9900);
    expect(await lib.balance(custody.address, token)).to.be.eql(100);
    expect(await web3.eth.getBalance(custody.address)).to.eql(10000000);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000);
    expect((await custody.tokens(user1)).toNumber()).to.eql(100);
  });
});

contract('Order posted', function (accounts) {
  let token, custody;
  let user1 = accounts[1];
  let user2 = accounts[2];

  before(async function () {
    [token, custody] = await setup(accounts);
    await lib.sendToken(100, user1, custody, token);
    await web3.eth.sendTransaction({from: user1, to: custody.address, value: 10000000});
    await lib.sendToken(200, user2, custody, token);
    await web3.eth.sendTransaction({from: user2, to: custody.address, value: 20000000});
  });
  /**
   * orders: price, quantity
   * signature
   * execution, user1 order, user2 order check signature
   */
  it('user can withdraw through exchange', async function () {
    let order1 = {uuid: 1, price: 10, qty: 100, isBuy: true, user: user1};
    let order2 = {uuid: 2, price: 10, qty: 100, isBuy: false, user: user2};
    let execution = {uuid: 3, price: 10, qty: 100};
    let types = ['uint', 'uint', 'uint', 'bool'];
    let [v1, r1, s1] = await getSignature(types, [order1.uuid, order1.price, order1.qty, order1.isBuy], order1.user);
    let [v2, r2, s2] = await getSignature(types, [order2.uuid, order2.price, order2.qty, order2.isBuy], order2.user);
    // console.log("R S", r1, s1, order1.uuid);
    await custody.withdraw([order1.price, order1.qty, order2.price, order2.qty, execution.price, execution.qty],
      [order1.uuid, order2.uuid, execution.uuid],
      [order1.isBuy, order2.isBuy],
      [order1.user, order2.user], [10, 10, 11, 11], [v1, v2], [r1, r2], [s1, s2]);
    expect(await lib.balance(user1, token)).to.be.eql(9910);
    expect(await lib.balance(user2, token)).to.be.eql(9811);
    expect(await lib.balance(custody.address, token)).to.be.eql(279);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000-10);
    expect((await custody.ethers(user2)).toNumber()).to.eql(20000000-11);
  });
});

contract('replay attack', function (accounts) {
  let token, custody;
  let user1 = accounts[1];
  let user2 = accounts[2];

  before(async function () {
    [token, custody] = await setup(accounts);
    await lib.sendToken(100, user1, custody, token);
    await web3.eth.sendTransaction({from: user1, to: custody.address, value: 10000000});
    await lib.sendToken(200, user2, custody, token);
    await web3.eth.sendTransaction({from: user2, to: custody.address, value: 20000000});
  });
  /**
   * orders: price, quantity
   * signature
   * execution, user1 order, user2 order check signature
   */
  it('same order used twice to match should fail', async function () {
    let order1 = {uuid: 1, price: 10, qty: 100, isBuy: true, user: user1};
    let order2 = {uuid: 2, price: 10, qty: 100, isBuy: false, user: user2};
    let execution = {uuid: 3, price: 10, qty: 100};
    let types = ['uint', 'uint', 'uint', 'bool'];
    let [v1, r1, s1] = await getSignature(types, [order1.uuid, order1.price, order1.qty, order1.isBuy], order1.user);
    let [v2, r2, s2] = await getSignature(types, [order2.uuid, order2.price, order2.qty, order2.isBuy], order2.user);


    await custody.withdraw([order1.price, order1.qty, order2.price, order2.qty, execution.price, execution.qty],
      [order1.uuid, order2.uuid, execution.uuid],
      [order1.isBuy, order2.isBuy],
      [order1.user, order2.user], [10, 10, 11, 11], [v1, v2], [r1, r2], [s1, s2]);
    try {
      await custody.withdraw([order1.price, order1.qty, order2.price, order2.qty, execution.price, execution.qty],
        [order1.uuid, order2.uuid, execution.uuid],
        [order1.isBuy, order2.isBuy],
        [order1.user, order2.user], [10, 10, 11, 11], [v1, v2], [r1, r2], [s1, s2]);
      expect().fail("Should not pass");
    } catch (e) {
      expect(e.message).to.not.eql("Should not pass");
    }
  });
});

function bytes32() {
  const buffer = new Buffer(32);
  uuid(null, buffer, 0);
  uuid(null, buffer, 16);

  return  ethUtil.bufferToHex(buffer);
  // return buffer.toString('hex');
}

async function getSignature(types, values, user) {
  let hash = abi.soliditySHA3(types, values);
  // console.log('user', user, 'types', types, 'values', values, 'hash', ethUtil.bufferToHex(hash));
  let sig = await web3.eth.sign(ethUtil.bufferToHex(hash), user);
  let {v, r, s} = ethUtil.fromRpcSig(sig);
  return [v, ethUtil.bufferToHex(r), ethUtil.bufferToHex(s)];
}

async function setup(accounts) {
  let custody = await Custody.deployed();
  let token = await StandardToken.new(1000000, "some awesome token", 0, "SAT");
  await token.transfer(accounts[1], 10000);
  await token.transfer(accounts[2], 10000);
  await custody.setToken(token.address);
  return [token, custody];
}