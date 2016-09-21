

const charset = require('superagent-charset');
const sa = require('superagent');
const superagentPromisePlugin = require('superagent-promise-plugin');
superagentPromisePlugin.Promise = require('es6-promise');

charset(sa);

const cheerio = require('cheerio')
const moment = require('moment')
const math = require('mathjs')
const co = require('co')

var vm = require('vm')

var _ = require('lodash-node');

var STATUS_MAP = {'开放申购':'open', '开放赎回':'open', '限制大额申购':'open-limit', '限制大额赎回':'open-limit', '封闭期':'close'}

function normalizeData(date, unit_net_value, acc_net_value, increase_rate, subscribe_status, redeem_status, dividend) {

  return {
    'date': moment(date).toDate(),
    'unit_net_value': Number.parseFloat(unit_net_value),
    'acc_net_value': Number.parseFloat(acc_net_value),
    'increase_rate': increase_rate,
    'subscribe_status': STATUS_MAP[subscribe_status] || subscribe_status,
    'redeem_status': STATUS_MAP[redeem_status] || redeem_status,
    'dividend': dividend
  }
}


var mongoskin = require('./async_mongoskin')
var db = mongoskin.db('mongodb://localhost:27017/lookfund', {native_parser:true});
db.bind('funds');
db.bind('tickets')

var start = async() => {
  try {
    let fundList = await fetchFundList();
    console.log(fundList.length)
    let fundItems = await db.funds.find({}).toArrayAsync()
    console.log(fundItems)
    // for (let i = 0, len = fundItems.length; i < len; i++) {
    //   let f = fundItems[i]
    //   let detail = await fetchFundDetail(f.code)
    //   // await db.funds.findOneAndUpdateAsync({code:f.code}, {$set: detail })
    //   console.log(detail)
    // }

    // let detail = await fetchFundDetail('000206')
    // console.log(detail)

    // let fetchedFundList = await fetchFundList()
    // // let items = await db.funds.find().toArrayAsync()
    // await db.funds.deleteManyAsync({})
    // await db.funds.insertManyAsync(fetchedFundList)
    //
    //
    // for (let i=0,len=fetchedFundList.length;i<len;i++) {
    //   var n = fetchedFundList[i]
    //   try {
    //     let fundTicketsData = await fetchFundTickets(n)
    //     await db.tickets.insertManyAsync(fundTicketsData)
    //
    //   } catch (e) {
    //     console.error(e)
    //   }
    // }

    // db.close()
  } catch (e) {
    console.error(e)
  }
}
start()

function fetchFundDetail(code) {
  return new Promise(function(resolve, reject) {
    var foo = async() => {
      let detail = {code:code}
      try {
        // 基本信息
        let basic = await new Promise(function(resolve, reject) {
          sa.get('http://fund.eastmoney.com/' + code + '.html')
            .end(function(err, res) {
              if (err) {
                reject(err)
              }
              let info = {}
              let $ = cheerio.load(res.text)

              let $td = $('.infoOfFund table td').eq(0)

              let $a = $td.find('a')

              let rawRiskTxt = $td.text()
              let risk = -1
              if (rawRiskTxt.indexOf('低风险') > 0) {
                risk = 1
              } else if (rawRiskTxt.indexOf('中低风险') > 0) {
                risk = 2
              } else if (rawRiskTxt.indexOf('中风险') > 0) {
                risk = 3
              } else if (rawRiskTxt.indexOf('中高风险') > 0) {
                risk = 4
              } else if (rawRiskTxt.indexOf('高风险') > 0) {
                risk = 5
              }

              let rawTypeTxt = $a.text().trim()
              info.type_label = rawTypeTxt
              info.risk = risk
              resolve(info)
            })
        })

        // 购买信息
        let buyInfo = await new Promise(function(resolve, reject) {
          const BUY_INFO_MAP = {'支持':true, '不支持':false}
          let tryCount = 0
          function getPage() {
            sa.get('http://fund.eastmoney.com/f10/jjfl_'+code+'.html').charset('gbk')
            .end(function(err, res) {
              if (!res) {
                reject()
                return
              }
              if (err) {
                reject(err)
              }
              let info = {}
              let $ = cheerio.load(res.text)

              let fixedStatusTxt = $('table.w770').find('tbody tr td.w135').eq(2).text()

              info.fixed_invest = BUY_INFO_MAP[fixedStatusTxt]

              if (typeof info.fixed_invest === 'undefined' && ++tryCount < 5) {
                // 读取失败，重新加载
                  getPage()
              }
              resolve(info)
            })
          }
          getPage()
        })
        detail = _.extend(basic, buyInfo, detail)
        resolve(detail)

      } catch (e) {
        console.error(e)
        reject(e)
      }

    }
    foo()

  })
}

function fetchFundList() {
  return new Promise(function(resolve, reject) {
    sa.get('http://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page=1,9999&dt=1462091017630&atfc=&onlySale=0')
      .end(function(err, res) {

        if (err) {
          reject(err)
        }

        let context = {}
        new vm.Script(res.text).runInNewContext(context)

        var fundList = []
        const defaultFee = 0.015
        context.db.datas.forEach(function(n, i) {
          fundList.push({
            'code': n[0].trim(),
            'name': n[1].trim(),
            'fee': Number.parseFloat(n[20].trim()) / 100 || defaultFee,
            'fee_tiantian': Number.parseFloat(n[17].trim()) / 100 || (defaultFee / 10),
            'available': !_.isEmpty(n[3])
          })
        })

        resolve(fundList)

      })
  })

}

function fetchFundTickets(fund) {
  console.log('Fetching ' + fund.code + ' - ' + fund.name)
  return new Promise(function(resolve, reject) {
    sa.get('http://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=' + fund.code + '&page=1&per=5000&sdate=&edate=').charset('gbk')
      .end(function(err, res) {
        if (err) {
          return reject(err)
        }

        let context = {}
        new vm.Script(res.text).runInNewContext(context)

        if (context.apidata.records <= 0) {
          return reject(err)
        }

        var $ = cheerio.load(context.apidata.content)

        var tickets = []
        $('tbody tr').each(function(idx, row) {
          var tds = $(row).children('td')
          function getTdData(idx) {
            return tds.eq(idx).text().trim()
          }
          let data = normalizeData(getTdData(0), getTdData(1), getTdData(2), getTdData(3), getTdData(4), getTdData(5), getTdData(6) )
          var ticket = _.extend(data, {
            fundId : fund._id,
            fundCode : fund.code,
            fundName : fund.name
          })
          tickets.push(ticket)

        })

        resolve(tickets)
      })

  })

}
