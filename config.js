module.exports = {
  baseCurrency: 'EUR',
  tradePercentage: 100,
  currencies: {
    'XBT': {
      percentage: 30,
      address: 'Bitcoin Mobile Wallet',
      withdrawMinimum: 0.02,
    },
    'ETH': {
      percentage: 30,
      address: 'Ether Mobile Wallet',
      withdrawMinimum: 0.2,
    },
    'LTC': {
      percentage: 10,
      address: 'Litecoin Hardware Wallet',
      withdrawMinimum: 2,
    },
    'XMR': {
      percentage: 10,
      address: 'Monero Wallet',
      withdrawMinimum: 1,
    },
    'XRP': {
      percentage: 10,
      address: 'Ripple Hardware Wallet',
      withdrawMinimum: 100,
    },
    'ZEC': {
      percentage: 5,
      address: 'Zcash Hardware Wallet',
      withdrawMinimum: 0.1,
    },
    'XLM': {
      percentage: 5,
      address: 'Lumen Wallet',
      withdrawMinimum: 500,
    }
  }
}
