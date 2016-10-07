
let vm = require('vm');
let _ = require('lodash-node');
let cheerio = require('cheerio');
let mongoskin = require('./async_mongoskin');
let moment = require('moment');

let fetch = require('./fetch');
let log4js = require('log4js');
log4js.configure('log4js.json');
let logger = log4js.getLogger("crawler");

async function fetchFundList() {
  logger.trace('Fetching fund list');
  // fetch page content from fund list
  const LIST_URL = 'http://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page=1,9999&dt=1462091017630&atfc=&onlySale=0';
  let response = await fetch(LIST_URL)

  // parse data from page content
  let context = {};
  new vm.Script(response.data).runInNewContext(context);
  let fundList = [];
  const DEFAULT_FEE = 0.015;

  for (let n of Array.from(context.db.datas).values()) {
    fundList.push({
      'code': n[0].trim(),
      'name': n[1].trim(),
      'costs': Number.parseFloat(n[20].trim()) / 100 || DEFAULT_FEE,
      'costs_tiantian': Number.parseFloat(n[17].trim()) / 100 || (DEFAULT_FEE / 10),
      'available': !_.isEmpty(n[3])
    })
  }

  return fundList;
}

async function fetchFundDetail(fund) {
  logger.trace(`Fetching ${fund.name}(${fund.code})`);

  const DETAIL_URL = 'http://fund.eastmoney.com/';
  const JJFL_URL = 'http://fund.eastmoney.com/f10/jjfl';

  let info = {...fund};
  // basic information
  let response = await fetch(DETAIL_URL + fund.code + '.html');
  let $ = cheerio.load(response.data);
  let $td = $('.infoOfFund table td').eq(0);
  let $a = $td.find('a');
  let rawRiskTxt = $td.text();
  let risk = -1;
  if (rawRiskTxt.indexOf('低风险') > 0) {
    risk = 1;
  } else if (rawRiskTxt.indexOf('中低风险') > 0) {
    risk = 2;
  } else if (rawRiskTxt.indexOf('中风险') > 0) {
    risk = 3;
  } else if (rawRiskTxt.indexOf('中高风险') > 0) {
    risk = 4;
  } else if (rawRiskTxt.indexOf('高风险') > 0) {
    risk = 5;
  }
  let rawTypeTxt = $a.text().trim();
  info.type_label = rawTypeTxt;
  info.type = {'混合型': 'hybrid', '股票型':'equity', '债券型':'bond', '指数型':'index', '保本型':'guaranteed', 'QDII':'QDII', 'LOF':'LOF'}[rawTypeTxt];
  info.risk = risk;

  // buy information
  const BUY_INFO_MAP = {'支持':true, '不支持':false};
  for (let tryCount = 0; tryCount<5; tryCount++) {
    let responseBuyPage = await fetch('http://fund.eastmoney.com/f10/jjfl_'+fund.code+'.html');
    let $buy = cheerio.load(response.data);
    let fixedStatusTxt = $buy('table.w770').find('tbody tr td.w135').eq(2).text();
    info.fixed_invest = BUY_INFO_MAP[fixedStatusTxt];
    if (typeof info.fixed_invest !== 'undefined') {
      break;
    }
  }
    return info;
}

async function fetchFundTickets(fund, startDate) {
  logger.trace(`Fetching tickets - ${fund.name}(${fund.code}) `);
  const STATUS_MAP = {'开放申购':'open', '开放赎回':'open', '限制大额申购':'open-limit', '限制大额赎回':'open-limit', '封闭期':'close'};
  function normalizeData(date, unit_net_value, acc_net_value, increase_rate, subscribe_status, redeem_status, dividend) {
    let day = moment(date);
    return {
      'date': day.toDate(),
      'date_str': day.toString(),
      'unit_net_value': Number.parseFloat(unit_net_value),
      'acc_net_value': Number.parseFloat(acc_net_value),
      'increase_rate': increase_rate,
      'subscribe_status': STATUS_MAP[subscribe_status] || subscribe_status,
      'redeem_status': STATUS_MAP[redeem_status] || redeem_status,
      'dividend': dividend
    }
  }

  logger.trace(`Fetching ${fund.code}(${fund.name})`);
  let sdate = _.isString(startDate) ? startDate : '';
  let url = `http://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${fund.code}&page=1&per=20000&sdate=${sdate}&edate=`;
  logger.debug(url);
  // let response = await request(url).catch(e => console.error(e));
  let response = await fetch(url, {}, 'gbk');
  if (!response) {
    return [];
  }

  // let data = response.body;
  let context = {};
  new vm.Script(response.data).runInNewContext(context)

  if (context.apidata.records <= 0) {
    logger.debug(`No tickets records for ${fund.name}(${fund.code})`);
    return [];
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
      fund_id : fund._id,
      fund_code : fund.code,
      fund_name : fund.name
    })
    tickets.push(ticket)

  })
  return tickets;

}

async function getLastNavDay() {
  let response = await fetch('http://fund.eastmoney.com/fund.html');
  let $ = cheerio.load(response.data);
  return $('body div.filter > div.tabs > ul:nth-child(3) > li:nth-child(1) > span').text().trim();
}


async function process() {
  let startTime = new Date();

  let db = mongoskin.db('mongodb://localhost:27017/lookfund', {native_parser:true});
  db.bind('funds');
  db.bind('tickets');
  db.bind('jobs');

  let lastJob = await db.jobs.find({},{sort:{$natural:-1}, limit:1}).toArrayAsync();
  let startDate;
  if (lastJob.length > 0) {
    lastJob = lastJob[0];
    startDate = moment(lastJob.nav_date).add(1, 'days').format('YYYY-MM-DD');
  }
  // fetch fund list
  let fetchedFundData = await fetchFundList();
  let lists = _.chunk(fetchedFundData, 5);
  async function fetchFundAllData(d) {
    let detail = await fetchFundDetail(d);
    let tickets = await fetchFundTickets(d, startDate);
    return {fund: detail, tickets: tickets};
  }

  for (let list of lists) {
    // fetch fund detail
    // let results = await Promise.all( _.map(list, d => fetchFundDetail(d)))
    let results = await Promise.all(_.map(list, d => fetchFundAllData(d)))

    // fetch fund tickets
    // let allTickets = await Promise.all( _.map(list, d => fetchFundTickets(d, startDate) ))

    // save funds data
    logger.trace(`Saving funds data`);
    for (let item of results.values()) {
      await db.funds.updateOneAsync({code:item.fund.code}, {$set: item.fund}, {upsert:true});
    }

    // save funds tickets
    logger.trace(`Saving tickets`);
    // for (let i = 0; i < allTickets.length; i++) {
    //   let tickets = allTickets[i];
    //   for (let j = 0; j < tickets.length; j++) {
    //     let ticket = tickets[j];
    //     await db.tickets.insertAsync(ticket);
    //   }
    // }
    for (let item of results.values()) {
      if (item.tickets && item.tickets.length > 0) {
        await db.tickets.insertManyAsync(item.tickets);
      } else {
        logger.debug(`empty data for ${item.fund.name}(${item.fund.code})`);
      }
    }
  }

  // get the last day
  let lastNavDay = await getLastNavDay();
  await db.jobs.insertAsync({date:moment().toDate(), nav_date:lastNavDay, status:'finished', fetched_funds:fetchedFundData.length});
  db.close();

  let endTime = new Date() - startTime;
  console.info(`Execution time ${endTime/1000}s`);

}
process().catch(e => {});
