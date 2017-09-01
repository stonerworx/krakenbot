module.exports = {
  baseCurrency: 'EUR',
  currencies: {
    XBT: {
      percentage: 30,
      address: 'Bitcoin Mobile Wallet',
      withdrawMinimum: 0.02,
    },
    ETH: {
      percentage: 30,
      address: 'Ether Mobile Wallet',
      withdrawMinimum: 0.2,
    },
    LTC: {
      percentage: 15,
      address: 'Litecoin Hardware Wallet',
      withdrawMinimum: 2,
    },
    XMR: {
      percentage: 15,
      address: 'Monero Wallet',
      withdrawMinimum: 1,
    },
    XRP: {
      percentage: 5,
      address: 'Ripple Hardware Wallet',
      withdrawMinimum: 100,
    },
    ZEC: {
      percentage: 5,
      address: 'Zcash Hardware Wallet',
      withdrawMinimum: 0.1,
    },
  },
};
