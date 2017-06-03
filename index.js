const config = require('./config');

if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
  console.error('KRAKEN_API_KEY and KRAKEN_API_SECRET need to be specified.');
  process.exit();
}

const total = Object.keys(config.currencies).reduce((previous, currency) =>
  previous + parseFloat(config.currencies[currency].percentage), 0);
if (total !== 100) {
  console.error(`Currency distribution needs to be 100% (is: ${total}%).`);
  process.exit();
}

const KrakenClient = require('kraken-api');
const kraken = new KrakenClient(process.env.KRAKEN_API_KEY, process.env.KRAKEN_API_SECRET);

const q = require('queue')({
  autostart: true,
  concurrency: 1,
});

kraken.api('Balance', null, (error, data) => {
  if (error) {
    console.error('Failed to fetch balances.', error);
  } else {
    for (const key of Object.keys(data.result)) {
      const currency = key.replace('X', '');
      if (key === `Z${config.baseCurrency}`) {
        // substract 2 from balance to pay for fees
        const balance = parseFloat(data.result[`Z${config.baseCurrency}`]) - 1;
        // don't buy if balance is less than 10
        if (balance >= 10) {
          calculateDistribution(balance);
        }
      } else if (config.currencies[currency]) {
        const address = config.currencies[currency].address;
        const amount = data.result[key];
        if (amount >= config.currencies[currency].withdrawMinimum && address) {
          withdraw(key, amount, address, 5);
        }
      }
    }
  }
});

function getRates(cb, retries) {
  const pairs = Object.keys(config.currencies)
  .map((currency) => `X${currency}Z${config.baseCurrency}`)
  .join(',');

  kraken.api('Ticker', { pair: pairs }, (error, data) => {
    if (error) {
      console.error('Failed to fetch rates.', error);
      if (retries > 0) {
        getRates(cb, retries - 1);
      }
    } else {
      cb(data.result);
    }
  });
}

function calculateDistribution(balance) {
  getRates((rates) => {
    console.log(`Buying crypto for ${balance} ${config.baseCurrency}.`);
    for (currency of Object.keys(config.currencies)) {
      const volume = Math.floor(balance / 100 * config.currencies[currency].percentage * 100) / 100;
      const rate = parseFloat(rates[`X${currency}Z${config.baseCurrency}`].a[0]);
      const volumeInCrypto = 1 / rate * volume;
      buy(currency, volumeInCrypto, volume, rate, 5);
    }
  }, 5);
}

function buy(currency, volumeInCrypto, volume, limit, retries) {
  if (volume < 1) {
    console.log(`${volume} ${config.baseCurrency} is not enough to buy ${currency}.`);
    return;
  }
  q.push((cb) => {
    console.log(`Buying ${volumeInCrypto} ${currency} for ${volume} ${config.baseCurrency} (${limit} ${config.baseCurrency}).`);
    const order = {
      pair: `X${currency}Z${config.baseCurrency}`,
      type: 'buy',
      ordertype: 'limit',
      price: limit,
      trading_agreement: 'agree',
      volume: volumeInCrypto,
    };
    kraken.api('AddOrder', order, (error, data) => {
      if (error) {
        console.error('Failed to place order.', error);
        if (retries > 0) {
          console.log('retrying..');
          buy(currency, volumeInCrypto, volume, limit, retries - 1);
        }
      } else {
        console.log('done.');
      }
      cb();
    });
  });
}

function withdraw(asset, amount, key, retries) {
  q.push((cb) => {
    console.log(`Withdrawing ${amount} ${asset} to ${key}`);
    const withdrawal = {
      asset,
      key,
      amount,
    };
    kraken.api('Withdraw', withdrawal, (error, data) => {
      if (error) {
        console.error('Failed to withdraw funds.', error);
        if (retries > 0) {
          console.log('retrying..');
          withdraw(asset, amount, key, retries - 1);
        }
      } else {
        console.log('done.');
      }
      cb();
    });
  });
}
