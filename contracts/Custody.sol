pragma solidity ^0.4.11;


/**
* people can put money
* signed request is received
    U and E have signed


*/

import "tokens/HumanStandardToken.sol";


contract Custody {

    event CustodyEvent(address _user, uint256 _value, string _unit, string _action);

    mapping (address => uint256) public ethers;

    mapping (address => uint256) public tokens;

    mapping (address => string) signatures;

    address public tokenid;

    address public owner;

    StandardToken public token;

    uint256 public tokenCount;

    uint256 public weiDeposited;

    modifier onlyOwner {
        require(msg.sender == owner);
        _;
    }

    function Custody(address _owner){
        owner = _owner;
    }

    function setToken(address _token) onlyOwner {
        tokenid = _token;
        token = HumanStandardToken(_token);
    }

    /*user can deposit ether*/
    function() payable {
        ethers[msg.sender] += msg.value;
    }

    /*user can deposit token. user will need to use token.allow(custody, _value) before calling this method.*/
    function depositToken(uint256 _value) returns (bool result){
        tokenCount += _value;
        tokens[msg.sender] += _value;
        token.transferFrom(msg.sender, this, _value);
        //        token.delegatecall(bytes4(sha3("transfer(address,uin256)")), this, _value);
        return true;
    }


}
