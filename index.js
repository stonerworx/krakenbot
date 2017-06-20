require('dotenv').config();
const config = require('./config');
const admin = require('firebase-admin');

if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
  console.error('KRAKEN_API_KEY and KRAKEN_API_SECRET need to be specified.');
  process.exit();
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  !process.env.FIREBASE_DATABASE_URL
) {
  console.error(
    'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY and FIREBASE_DATABASE_URL need to be specified.',
  );
  process.exit();
}

const total = Object.keys(config.currencies).reduce(
  (previous, currency) =>
    previous + parseFloat(config.currencies[currency].percentage),
  0,
);
if (total !== 100) {
  console.error(`Currency distribution needs to be 100% (is: ${total}%).`);
  process.exit();
}

const KrakenClient = require('kraken-api');
const kraken = new KrakenClient(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET,
);

const q = require('queue')({
  autostart: false,
  concurrency: 1,
});

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const database = admin.database();

function average(trades) {
  return (
    trades.reduce((acc, trade) => acc + parseFloat(trade[0]), 0) / trades.length
  );
}

function saveTrades(pair, buy, sell, cb) {
  const timestamp = new Date().getTime();
  const entry = database.ref(`/trades/${pair}`).push();
  entry.set({ buy, sell, timestamp }).then(data => cb()).catch(error => {
    console.error(error);
    cb();
  });
}

function saveOrder(pair, volume, price, type, cb) {
  const timestamp = new Date().getTime();
  const entry = database.ref(`/orders/${pair}`).push();
  entry.set({ volume, price, type, timestamp }).then(data => cb()).catch(error => {
    console.error(error);
    cb();
  });
}

function getLastOrder(pair, cb) {
  const orders = database
    .ref(`/orders/${pair}`)
    .orderByChild('type')
    .equalTo('buy');
  orders.once('value').then(o => {
    const order = o.val();
    if (order) {
      const values = Object.values(order).sort((a, b) => a.timestamp < b.timestamp);
      cb(values[0]);
    } else {
      cb(false);
    }
  });
}

function getBuySellForPair(pair, since, cb) {
  kraken.api('Trades', { pair, since }, (error, data) => {
    if (error) {
      console.error(`Failed to fetch trades for ${pair}.`, error);
      cb();
    } else {
      const buyTrades = data.result[pair].filter(trade => trade[3] === 'b');
      const buy = average(buyTrades);
      const sellTrades = data.result[pair].filter(trade => trade[3] === 's');
      const sell = average(sellTrades);
      cb(buy, sell);
    }
  });
}

function fetchAssetPairs(cb) {
  kraken.api('AssetPairs', null, (error, data) => {
    if (error) {
      console.error('Failed to fetch asset pairs.', error);
      cb();
    } else {
      const pairs = Object.keys(data.result).filter(
        pair => pair.includes('EUR') && !pair.includes('.d'),
      );
      cb(pairs);
    }
  });
}

function fetchRecentTrades(cb) {
  fetchAssetPairs(pairs => {
    if (!pairs) {
      cb();
    } else {
      const since = new Date();
      since.setMinutes(since.getMinutes() - 10);
      let done = 0;
      const results = [];
      pairs.forEach(pair =>
        getBuySellForPair(pair, since, (buy, sell) => {
          if (!buy || !sell) {
            cb();
          } else {
            const latest = database
              .ref(`/trades/${pair}`)
              .orderByChild('timestamp')
              .limitToLast(6);
            latest.once('value').then(last => {
              const buyAvergage =
                Object.values(last.val()).reduce(
                  (acc, data) => acc + parseFloat(data.buy),
                  0,
                ) / 6;
              const change = buy - buyAvergage;
              const changePercentage = 100 / buyAvergage * buy - 100;
              results.push({
                pair,
                buyAvergage,
                buy,
                sell,
                change,
                changePercentage,
              });
              saveTrades(pair, buy, sell, () => {
                done++;
                if (done === pairs.length) {
                  cb(results);
                }
              });
            });
          }
        }),
      );
    }
  });
}

function getRates(pairs, cb, retries) {
  kraken.api('Ticker', { pair: pairs }, (error, data) => {
    if (error) {
      console.error('Failed to fetch rates.', error);
      if (retries > 0) {
        getRates(pairs, cb, retries - 1);
      }
    } else {
      cb(data.result);
    }
  });
}

function calculateDistribution(balance) {
  const pairs = Object.keys(config.currencies)
    .map(currency => `X${currency}Z${config.baseCurrency}`)
    .join(',');
  getRates(pairs, rates => {
    console.log(`Buying crypto for ${balance} ${config.baseCurrency}.`);
    for (currency of Object.keys(config.currencies)) {
      const volume =
        Math.floor(
          balance / 100 * config.currencies[currency].percentage * 100,
        ) / 100;
      const rate = parseFloat(
        rates[`X${currency}Z${config.baseCurrency}`].a[0],
      );
      const volumeInCrypto = 1 / rate * volume;
      buy(currency, volumeInCrypto, volume, rate, 0);
    }
  }, 5);
}

function addOrder(type, pair, volumeInCrypto, limit, retries, cb) {
  const order = {
    pair,
    type,
    ordertype: 'limit',
    price: limit,
    trading_agreement: 'agree',
    volume: volumeInCrypto,
  };
  kraken.api('AddOrder', order, (error, data) => {
    if (error) {
      console.error(`Failed to place ${type} order.`, error);
      if (retries > 0) {
        console.log('retrying..');
        addOrder(type, pair, volumeInCrypto, limit, retries - 1, cb);
      } else {
        cb(false);
      }
    } else {
      console.log('done.');
      cb(true);
    }
  });
}

function buy(currency, volumeInCrypto, volume, limit, retries) {
  if (volume < 1) {
    console.log(
      `${volume} ${config.baseCurrency} is not enough to buy ${currency}.`,
    );
    return;
  }
  q.push(cb => {
    console.log(
      `Buying ${volumeInCrypto} ${currency} for ${volume} ${config.baseCurrency} (${limit} ${config.baseCurrency}).`,
    );
    const pair = `X${currency}Z${config.baseCurrency}`;
    addOrder('buy', pair, volumeInCrypto, limit, retries, cb)
  });
}

function withdraw(asset, amount, key, retries) {
  q.push(cb => {
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

function createOrders(amount, buy, sell, cb) {
  const createSellOrder = (i) => {
    const s = sell[i];
    getLastOrder(s.pair, order => {
      const change = 100 / order.price * s.sell;
      if (order && change >= 101) {
        console.log(`sell ${order.volume} ${s.pair} at ${s.sell} (was ${order.price})`);
        addOrder('sell', s.pair, order.volume, s.sell, 0, (success) => {
          if (success) {
            saveOrder(s.pair, order.volume, s.sell, 'sell', () => {
              if (i < sell.length - 1) {
                createSellOrder(i+1);
              } else {
                cb();
              }
            });
          } else {
            if (i < sell.length - 1) {
              createSellOrder(i + 1);
            } else {
              cb();
            }
          }
        });
      } else {
        if (i < sell.length - 1) {
          createSellOrder(i+1);
        } else {
          cb();
        }
      }
    });
  }

  const createBuyOrder = (i) => {
    const b = buy[i];
    const volumeInCrypto = Math.floor(amount / buy.length) / b.buy;
    console.log(`buy ${volumeInCrypto} ${b.pair} at ${b.buy}`);
    addOrder('buy', b.pair, volumeInCrypto, b.buy, 0, (success) => {
      if (success) {
        saveOrder(b.pair, volumeInCrypto, b.buy, 'buy', () => {
          if (i < buy.length - 1) {
            createBuyOrder(i + 1);
          } else {
            createSellOrder(0);
          }
        });
      } else {
        if (i < buy.length - 1) {
          createBuyOrder(i+1);
        } else {
          createSellOrder(0);
        }
      }
    });
  }

  if (amount > 0) {
    createBuyOrder(0);
  } else {
    createSellOrder(0);
  }
}

function trade(amount) {
  console.log(`trading with ${amount}`);
  q.push(cb =>
    fetchAssetPairs(pairs => {
      if (pairs) {
        getRates(pairs.join(','), rates => {
          if (rates) {
            let done = 0;
            const buy = [];
            const sell = [];
            Object.keys(rates).forEach(pair => {
              const rate = rates[pair];
              const ask = rate.a[0];
              const bid = rate.b[0];

              const latest = database
                .ref(`/trades/${pair}`)
                .orderByChild('timestamp')
                .limitToLast(6);
              latest.once('value').then(last => {
                let change = 0;
                if (last.val()) {
                  const buyAvergage =
                    Object.values(last.val()).reduce(
                      (acc, data) => acc + parseFloat(data.buy),
                      0,
                    ) / 6;
                  change = ask - buyAvergage;
                }
                saveTrades(pair, ask, bid, () => {
                  if (change > 0) {
                    buy.push({
                      pair: pair,
                      buy: ask
                    });
                  } else if (change < 0) {
                    sell.push({
                      pair: pair,
                      sell: bid
                    });
                  }
                  done++;
                  if (done === Object.keys(rates).length) {
                    createOrders(amount, buy, sell, cb);
                  }
                });
              });
            });   
          } else {
            cb();
          }
        }, 5);
      } else {
        cb();
      }
    }),
  );
}

kraken.api('Balance', null, (error, data) => {
  if (error) {
    console.error('Failed to fetch balances.', error);
  } else {
    for (const key of Object.keys(data.result)) {
      const currency = key.replace('X', '');
      if (key === `Z${config.baseCurrency}`) {
        // substract 5 from balance to pay for fees
        const balance = parseFloat(data.result[`Z${config.baseCurrency}`]) - 5;
        const tradeVolume = balance / 100 * config.tradePercentage;
        if (tradeVolume > 10) {
          trade(tradeVolume);
        } else {
          trade(0);
        }
        if (balance - tradeVolume >= 10) {
          calculateDistribution(balance - tradeVolume);
        }
      } else if (config.currencies[currency]) {
        const address = config.currencies[currency].address;
        const amount = data.result[key];
        if (amount >= config.currencies[currency].withdrawMinimum && address) {
          // withdraw(key, amount, address, 5);
        }
      }
    }
  }

  q.start((err) => {
    console.log('done');
    admin.database().goOffline();
    process.exit(0);
  });
});
