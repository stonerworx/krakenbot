# Krakenbot 🐙

Simple Node script for standing orders on Kraken exchange.

* configure in `config.js`
* checks your current balances on Kraken
* buys crypto in the defined distribution if balance in base currency is present
* withdraws funds to your defined addresses when balance in crypto is present

Run it somewhere as a regular job, ie. on heroku.

Use at your own risk.

Currencies that work at the moment:
* XBT
* ETH
* LTC
* ZEC

Currencies that don't work at the moment:
* XMR
* XRP
* XLM
* DASH

Feel free to contribute, adapt, or just use.
