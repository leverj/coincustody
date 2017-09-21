const Custody = artifacts.require("./Custody.sol");
const conf = require("../config/custody.json");

module.exports = async function (deployer) {
  await deployer.deploy(Custody, conf.owner);
};
