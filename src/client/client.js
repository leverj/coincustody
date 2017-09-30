const Web3 = require('web3')
const stringify = require('safe-json-stringify')

module.exports = (function () {
  let client = {}

  function init() {
    // let httpProvider        =  (window.web3 && window.web3.currentProvider)// ||
    // const web3              = new Web3(httpProvider)
    print('web3.givenProvider', web3.currentProvider)
    client.web3             = (new Web3(web3.currentProvider))// || new Web3.providers.HttpProvider('https://ropsten.infura.io')
    const contractInterface = [
      {
        "constant": false,
        "inputs"  : [],
        "name"    : "emergencyToggle",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "preBuyersDispensedTo",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "totalTimelockedBeneficiaries",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "freezeBlock",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "startBlock",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "wallet",
        "outputs" : [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_newBlock",
            "type": "uint256"
          }
        ],
        "name"    : "changeStartBlock",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_beneficiaries",
            "type": "address[]"
          },
          {
            "name": "_beneficiariesTokens",
            "type": "uint256[]"
          },
          {
            "name": "_timelocks",
            "type": "uint256[]"
          },
          {
            "name": "_periods",
            "type": "uint256[]"
          }
        ],
        "name"    : "distributeTimelockedTokens",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "timeLockedBeneficiariesDisbursedTo",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "saleState",
        "outputs" : [
          {
            "name": "state",
            "type": "string"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "totalPreBuyers",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "timelockedTokensDisbursed",
        "outputs" : [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "owner",
        "outputs" : [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_preBuyers",
            "type": "address[]"
          },
          {
            "name": "_preBuyersTokens",
            "type": "uint256[]"
          }
        ],
        "name"    : "distributePreBuyersRewards",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_wallet",
            "type": "address"
          }
        ],
        "name"    : "changeWallet",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "price",
        "outputs" : [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_newPrice",
            "type": "uint256"
          }
        ],
        "name"    : "changePrice",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": false,
        "inputs"  : [
          {
            "name": "_newOwner",
            "type": "address"
          }
        ],
        "name"    : "changeOwner",
        "outputs" : [],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "emergencyFlag",
        "outputs" : [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "preSaleTokensDisbursed",
        "outputs" : [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "getAvailableTokens",
        "outputs" : [
          {
            "name": "balance",
            "type": "uint256"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "constant": true,
        "inputs"  : [],
        "name"    : "token",
        "outputs" : [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable" : false,
        "type"    : "function"
      },
      {
        "inputs" : [
          {
            "name": "_owner",
            "type": "address"
          },
          {
            "name": "_wallet",
            "type": "address"
          },
          {
            "name": "_tokenSupply",
            "type": "uint256"
          },
          {
            "name": "_tokenName",
            "type": "string"
          },
          {
            "name": "_tokenDecimals",
            "type": "uint8"
          },
          {
            "name": "_tokenSymbol",
            "type": "string"
          },
          {
            "name": "_price",
            "type": "uint256"
          },
          {
            "name": "_startBlock",
            "type": "uint256"
          },
          {
            "name": "_freezeBlock",
            "type": "uint256"
          },
          {
            "name": "_totalPreBuyers",
            "type": "uint256"
          },
          {
            "name": "_totalTimelockedBeneficiaries",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type"   : "constructor"
      },
      {
        "payable": true,
        "type"   : "fallback"
      },
      {
        "anonymous": false,
        "inputs"   : [
          {
            "indexed": true,
            "name"   : "purchaser",
            "type"   : "address"
          },
          {
            "indexed": false,
            "name"   : "amount",
            "type"   : "uint256"
          }
        ],
        "name"     : "PurchasedTokens",
        "type"     : "event"
      },
      {
        "anonymous": false,
        "inputs"   : [
          {
            "indexed": true,
            "name"   : "preBuyer",
            "type"   : "address"
          },
          {
            "indexed": false,
            "name"   : "amount",
            "type"   : "uint256"
          }
        ],
        "name"     : "TransferredPreBuyersReward",
        "type"     : "event"
      },
      {
        "anonymous": false,
        "inputs"   : [
          {
            "indexed": false,
            "name"   : "beneficiary",
            "type"   : "address"
          },
          {
            "indexed": false,
            "name"   : "disburser",
            "type"   : "address"
          },
          {
            "indexed": false,
            "name"   : "amount",
            "type"   : "uint256"
          }
        ],
        "name"     : "TransferredTimelockedTokens",
        "type"     : "event"
      }
    ];
    const contractAddress   = '0x6a4be11fd26a7fd6ea60b2955fb2a71f52eebf90';
    const owner             = '0x833a2FA19349dAf085B94376ac3042197cF66443'

    client.web3.eth.getAccounts(account => {
      print('account', account[0])
    })

    // print('accounts',stringify(client.web3.eth.accounts))//(function(err, val){})
    // const contract          = new web3.eth.Contract(contractInterface, contractAddress)
    // print('contract', contract.methods)
    // client.web3.eth.getBalance(owner).then(function (balance) {
    //   print(owner, balance)
    // }).catch(printError)

  }

  function printError(e) {
    console.error(e)
    print('error', e)
  }

  function print(key, value) {
    let $div = $('#key')
    if ($div.length === 0) {
      $div = $('<code>').prop('id', value)
      // $div.append('<br>')
      $('#log-area').append($('<br>'))
      $('#log-area').append($div)
    }
    $div.text(key + " : " + value)
  }

  $(document).ready(init)

  return client
})()