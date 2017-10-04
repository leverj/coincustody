const Custody = artifacts.require("./Custody.sol");
const conf = require("config").custody;
console.log('config', conf);
module.exports = async function (deployer) {
  await deployer.deploy(Custody, conf.owner, conf.freezeBlock, conf.withdrawBlock);
  let custody = await Custody.deployed();
  await custody.setToken(conf.tokenid);
};
