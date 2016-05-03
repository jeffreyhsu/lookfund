
var mongoskin = require('./async_mongoskin')
var moment = require('moment')

let totalInvestment = 0
let totalBalance = 0
let totalShares = 0
let totalFeeCost = 0
let totalHoldDays = 0

async function backtest(code, startDate, endDate, roundMoney, roundCount) {

  var db = mongoskin.db('mongodb://localhost:27017/lookfund', {native_parser:true});
  db.bind('funds');
  db.bind('tickets')

  let fund = await db.funds.findOneAsync({code: code})
  let tickets = await db.tickets.find({fundCode: code}).sort({date:1}).toArrayAsync()

  let firstHoldDate = moment(tickets[0].date)
  totalHoldDays = moment().diff(firstHoldDate, 'day')

  tickets.forEach(function(t) {
    if (t.subscribe_status === 'open') {
      orderValue(code, 500, t.acc_net_value, fund.fee)
    }
  })

  let latestNetValue = tickets[tickets.length-1].acc_net_value
  totalBalance =  Math.round(latestNetValue * totalShares)
  let totalReturns = totalBalance - totalInvestment
  let report = {
    totalInvestment : totalInvestment,
    totalBalance : totalBalance,
    totalReturns : totalReturns,
    totalReturnsRate: totalReturns / totalInvestment,
    // [（投资内收益 / 本金）/ 投资天数] * 365 ×100%
    annualizedReturnsRate : (totalReturns / totalInvestment / totalHoldDays) * 365,
  }

  console.log(report)

  db.close()
}

backtest('000001')

function orderValue(code, value, price, fee) {
  let feeCost = value * fee
  totalFeeCost += feeCost

  let shares = (value - feeCost) / price
  totalShares += shares
  totalInvestment += value
}
