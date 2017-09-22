pragma solidity ^0.4.11;


/**
* people can put money
* signed request is received
    U and E have signed


*/

import "tokens/HumanStandardToken.sol";


contract Custody {

    struct Order {
    uint uuid;
    uint price;
    uint qty;
    bool isBuy;
    }

    struct Execution {
    uint executionid;
    uint price;
    uint qty;
    }

    event LOG(address _user, bytes32 _hash);

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
//nonce needs to be added to prevent replay attack
    function withdraw(uint[] priceandqty,
    uint[] ids,
    bool[] isBuy,
    address[] users,
    uint256[] withdraws,
    uint8[] v, bytes32[] r, bytes32[] s) onlyOwner {
        // loop over all pending executions
        Order memory order1 = Order(ids[0], priceandqty[0], priceandqty[1], isBuy[0]);
        Order memory order2 = Order(ids[1], priceandqty[2], priceandqty[3], isBuy[1]);
        Execution memory execution = Execution(ids[2], priceandqty[4], priceandqty[5]);
        require(isVerified(order1, users[0], v[0], r[0], s[0]));
        require(isVerified(order2, users[1], v[1], r[1], s[1]));
        validateOrderAndExecution(order1, execution);
        validateOrderAndExecution(order2, execution);
        send(users[0],  withdraws[0], withdraws[1]);
        send(users[1], withdraws[2], withdraws[3]);
    }

    function send(address _user, uint256 _eth, uint256 _tokens){
        require(ethers[_user] >= _eth);
        require(tokens[_user] >= _tokens);
        ethers[_user] -= _eth;
        tokens[_user] -= _tokens;
        _user.transfer(_eth);
        token.transfer(_user, _tokens);
    }

    function processExecution(address buyer, address seller, Execution execution) internal {
        uint256 amount = execution.price * execution.qty;
        tokens[buyer] += execution.qty;
        tokens[seller] -= execution.qty;
        ethers[buyer] -= amount;
        ethers[seller] += amount;
    }

    function validateOrderAndExecution(Order order, Execution execution) internal {
        if (order.isBuy) {
            require(order.price >= execution.price);
        }
        else {
            require(order.price <= execution.price);
        }
        require(order.qty >= execution.qty);
    }

    function isVerified(Order order, address user, uint8 v, bytes32 r, bytes32 s) internal returns (bool result){
        bytes32 hash = keccak256(order.uuid, order.price, order.qty, order.isBuy);
        return user == ecrecover(keccak256("\x19Ethereum Signed Message:\n32", hash), v, r, s);
    }


}
