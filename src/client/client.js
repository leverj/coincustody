const Web3 = require('web3');
const stringify = require('safe-json-stringify');
const commonLib = require("../common/lib");
const Order = require("../common/domain/Order");
const rest = require('rest.js');

module.exports = (function () {
  let client = {};
  let config, erc20, custody, user;

  function handleEvents() {
    $("#place-order").click(placeOrder);
    $("#approve-token-action").click(approveTokens);
    $("#transfer-token-action").click(transferTokens);
  }

  function placeOrder() {
    let side = $("#side").val() === "true";
    let quantity = $("#quantity").val() - 0;
    let price = $("#price").val() - 0;
    let uuid = commonLib.timeuuid();
    let order = new Order(uuid, price, quantity, 0, side,);
  }

  async function populate() {
    config = (await rest.get("api/v1/config")).body;
    web3 = new Web3(web3.currentProvider) || new Web3.providers.HttpProvider('https://ropsten.infura.io');
    user = (await web3.eth.getAccounts())[0];
    $("#user-id").text(user);
    erc20 = new web3.eth.Contract(config.abi.erc20, config.common.tokenid);
    custody = new web3.eth.Contract(config.abi.custody, config.common.custodyid);
    $("#token-balance").text(await erc20.methods.balanceOf(user).call());
    $("#token-id").text(erc20._address);
    $("#eth-balance").text(await web3.eth.getBalance(user));
    $("#token-approved").text(await erc20.methods.allowance(user, custody._address).call());
    // $("#token-allowed").text(await erc20.methods.allowance(custody._address, erc20._address).call());
  }



  async function approveTokens(){
    console.log('approving tokens');
    let count = $("#approve-token").val() - 0;
    await erc20.methods.approve(custody._address, count).send({from: user});
  }

  async function transferTokens(){
    console.log('transfering tokens');
    let count = $("#transfer-token").val() - 0;
    await custody.methods.depositToken(count).send({from: user});
  }


  function init() {
    populate();
    handleEvents();
  }

  $(document).ready(init);

  return client
})();