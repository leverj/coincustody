const Custody = artifacts.require("./Custody.sol");

module.exports = function (deployer) {
  deployer.deploy(Custody);
};
