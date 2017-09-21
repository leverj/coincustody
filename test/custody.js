const StandardToken = artifacts.require("./HumanStandardToken.sol");
const Custody = artifacts.require("./Custody.sol");

const expect = require("expect.js");
const fs = require('fs');
const BN = require('bn.js');
const HttpProvider = require('ethjs-provider-http');
const EthRPC = require('ethjs-rpc');
const EthQuery = require('ethjs-query');
const Web3 = require('web3');
const lib = require('../lib');
const debug = lib.Debug(__filename);


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
    await web3.eth.sendTransaction({from: user1, to: custody.address, value: 10000000});
    expect(await lib.balance(user1, token)).to.be.eql(9900);
    expect(await lib.balance(custody.address, token)).to.be.eql(100);
    expect(await web3.eth.getBalance(custody.address)).to.eql(10000000);
    expect((await custody.ethers(user1)).toNumber()).to.eql(10000000);
    expect((await custody.tokens(user1)).toNumber()).to.eql(100);
  });
});

async function setup(accounts) {
  let custody = await Custody.deployed();
  let token = await StandardToken.new(1000000, "some awesome token", 0, "SAT");
  await token.transfer(accounts[1], 10000);
  await custody.setToken(token.address);
  return [token, custody];
}