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
const _ = require('lodash');

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
    // await custody.delegateTokens(100, {from: user1});
    await lib.forceMine(300);
    await web3.eth.sendTransaction({from: user1, to: custody.address, value: 10000000});
    expect((await custody.tokens(user1)).toNumber()).to.eql(100);
    expect(await lib.balance(user1, token)).to.be.eql(9900);
    expect(await lib.balance(custody.address, token)).to.be.eql(100);
    expect(await web3.eth.getBalance(custody.address)).to.eql(10000000);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000);

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
    let [order1, order2, execution] = orders(user1, user2);
    await syncExecutions(custody, order1, order2, execution);
    await lib.forceMine(300);
    await custody.withdraw(user1, 10, 10);
    await custody.withdraw(user2, 11, 11);
    expect(await lib.balance(user1, token)).to.be.eql(9910);
    expect(await lib.balance(user2, token)).to.be.eql(9811);
    expect(await lib.balance(custody.address, token)).to.be.eql(279);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000 - 10 - execution.qty*execution.price);
    expect((await custody.ethers(user2)).toNumber()).to.eql(20000000 - 11 + execution.qty*execution.price);
    expect((await custody.tokens(user1)).toNumber()).to.eql(100 - 10 + execution.qty);
    expect((await custody.tokens(user2)).toNumber()).to.eql(200 - 11 - execution.qty);
  });
});

contract('execution sync', function(accounts){
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

  it('execution sync should not be able to put any user balance to negative', async function () {
    let [order1, order2, execution] = orders(user1, user2);
    execution.qty = 210;
    try {
      await syncExecutions(custody, order1, order2, execution);
      expect().fail('should have failed')
    } catch (e) {
      expect(e.message).to.eql('VM Exception while processing transaction: invalid opcode');
    }
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
    let [order1, order2, execution] = orders(user1, user2);
    await syncExecutions(custody, order1, order2, execution);
    try {
      await syncExecutions(custody, order1, order2, execution);
      expect().fail("Should not pass");
    } catch (e) {
      expect(e.message).to.eql("VM Exception while processing transaction: invalid opcode");
    }
  });
});

contract('User halting custody contract', function (accounts) {
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
  it('user should be able to halt custody contract if found any discrepancy to avoid further damage.', async function () {
    let [order1, order2, execution] = orders(user1, user2);
    let cancel = _.clone(order1);
    cancel.cancelled = order1.qty;
    try {
      await notifyReplay(custody, cancel, accounts[0]);
      expect().fail("should have failed");
    } catch (e) {
      expect(e.message).to.eql("VM Exception while processing transaction: invalid opcode");
    }
    // compromised exchange sends execution with cancelled order of user1.
    await syncExecutions(custody, order1, order2, execution);
    // user1 finds that his cancelled order has been executed by exchange,
    // therefore notifying custody contract.
    await notifyReplay(custody, cancel, accounts[0]);
    expect(await custody.disabled()).to.eql(true);
  });
});

contract('User halting custody contract for partial cancelled', function (accounts) {
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
  it('user should be able to halt custody contract if found any discrepancy to avoid further damage.', async function () {
    let [order1, order2, execution] = orders(user1, user2);
    execution.qty = 50;
    // exchange sends execution for half the quantity.
    await syncExecutions(custody, order1, order2, execution);
    // user1 cancels rest of the order
    // compromised exchange sends execution with cancelled order of user1.
    await syncExecutions(custody, order1, order2, execution);
    // user1 finds that his cancelled order has been executed by exchange,
    // therefore notifying custody contract.
    let cancel = _.clone(order1);
    cancel.cancelled = 50;
    await  notifyReplay(custody, cancel, accounts[0]);
    expect(await custody.disabled()).to.eql(true);
  });
});

contract("owner can not change tokenid after freezeBlock", function (accounts) {
  let token, custody;
  let user1 = accounts[1];
  let user2 = accounts[2];

  before(async function () {
    [token, custody] = await setup(accounts);
  });

  it("should not be able to change token id after freezeBlock", async function () {
    await lib.forceMine(new BN(300));
    try {
      await custody.setToken(token.address);
      expect().fail('should have fail')
    } catch (e) {
      expect(e.message).to.eql('VM Exception while processing transaction: invalid opcode');
    }
  });
});

contract("withraw funds", function (accounts) {
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

  it("user should only able to withdraw fund after certain blocks have paased after last update.", async function () {
    let [order1, order2, execution] = orders(user1, user2);
    await syncExecutions(custody, order1, order2, execution);
    try {
      await custody.withdraw(user1, 10, 10);
      expect().fail('should have fail');
    } catch (e) {
      expect(e.message).to.eql('VM Exception while processing transaction: invalid opcode');
    }
    await lib.forceMine(200);
    await custody.withdraw(user1, 10, 10);
    expect(await lib.balance(user1, token)).to.be.eql(9910);
    expect(await lib.balance(custody.address, token)).to.be.eql(290);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000 - 10 - 100*10);
  });
});

function bytes32() {
  const buffer = new Buffer(32);
  uuid(null, buffer, 0);
  uuid(null, buffer, 16);

  return ethUtil.bufferToHex(buffer);
  // return buffer.toString('hex');
}

async function getSignature(order, signer) {
  let types = ['uint', 'uint', 'uint', 'uint', 'uint', 'bool', 'address'];
  let values = [order.uuid, order.price, order.qty, order.cancelled, order.expiry, order.isBuy, order.user];
  let hash = abi.soliditySHA3(types, values);
  let sig = await web3.eth.sign(ethUtil.bufferToHex(hash), signer);
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

async function notifyReplay(custody, cancel, exchange) {
  let [cv, cr, cs] = await getSignature(cancel, exchange);
  await  custody.notifyReplay([cancel.uuid, cancel.price, cancel.qty, cancel.cancelled, cancel.expiry], cancel.isBuy, cancel.user, cv, cr, cs, {from: cancel.user});

}

function withdrawParams(order1, order2, execution) {
  let param1 = [
    order1.uuid, order1.price, order1.qty, order1.cancelled, order1.expiry,
    order2.uuid, order2.price, order2.qty, order2.cancelled, order2.expiry,
    execution.uuid, execution.price, execution.qty
  ];
  let param2 = [order1.isBuy, order2.isBuy];
  let param3 = [order1.user, order2.user];

  return [param1, param2, param3];
}

function orderParams(order) {
  let param1 = [order.uuid, order.price, order.qty, order.cancelled, order.expiry];
  return [param1, order.isBuy, order.user];
}

async function syncExecutions(custody, order1, order2, execution) {
  let [v1, r1, s1] = await getSignature(order1, order1.user);
  let [v2, r2, s2] = await getSignature(order2, order2.user);
  let param1 = [
    order1.uuid, order1.price, order1.qty, order1.cancelled, order1.expiry,
    order2.uuid, order2.price, order2.qty, order2.cancelled, order2.expiry,
    execution.uuid, execution.price, execution.qty
  ];
  await custody.syncExecutions(param1, [order1.isBuy, order2.isBuy], [order1.user, order2.user], [v1, v2], [r1, r2], [s1, s2]);
}

function orders(user1, user2) {
  let expiry = Math.round((Date.now() + 5 * 60 * 1000) / 1000);
  let order1 = {uuid: 1, price: 10, qty: 100, cancelled: 0, isBuy: true, user: user1, expiry};
  let order2 = {uuid: 2, price: 10, qty: 100, cancelled: 0, isBuy: false, user: user2, expiry};
  let execution = {uuid: 3, price: 10, qty: 100};
  return [order1, order2, execution];
}
