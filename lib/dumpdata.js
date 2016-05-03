'use strict';

var charset = require('superagent-charset');
var sa = require('superagent');
charset(sa);
var cheerio = require('cheerio');
var moment = require('moment');
var math = require('mathjs');
var co = require('co');

var _ = require('lodash-node');

var STATUS_MAP = { '开放申购': 'open', '开放赎回': 'open', '限制大额申购': 'open-limit', '限制大额赎回': 'open-limit', '封闭期': 'close' };

function normalizeData(date, unit_net_value, acc_net_value, increase_rate, subscribe_status, redeem_status, dividend) {

  return {
    'date': moment(date),
    'unit_net_value': parseFloat(unit_net_value),
    'acc_net_value': parseFloat(acc_net_value),
    'increase_rate': increase_rate,
    'subscribe_status': STATUS_MAP[subscribe_status] || subscribe_status,
    'redeem_status': STATUS_MAP[redeem_status] || redeem_status,
    'dividend': dividend
  };
}

var MongoClient = require('mongodb').MongoClient;
// Connection url
var url = 'mongodb://localhost:27017/lookfund';
// Connect using MongoClient
MongoClient.connect(url, function (err, db) {

  var fundsCol = db.collection('funds');
  var ticketsCol = db.collection('tickets');

  fetchFundList(function (data) {
    fundsCol.deleteMany({}, function (err) {
      fundsCol.insertMany(data, function (err, r) {

        ticketsCol.deleteMany({}, function (err) {
          r.ops.forEach(function (o) {
            if (o.available) {
              fetchFundData(o.code, function (tickets) {

                var ticket = _.extend(tickets, {
                  fundId: o._id,
                  fundCode: o.code,
                  fundName: o.name
                });

                ticketsCol.insertOne(ticket);
              });
            }
          });
        });

        db.close();
      });
    });
  });
});

function fetchFundList(callback) {
  sa.get('http://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page=1,9999&dt=1462091017630&atfc=&onlySale=0').end(function (err, res) {

    if (err) {
      return;
    }

    eval(res.text);
    var fundList = [];
    var defaultFee = 0.015;
    db.datas.forEach(function (n, i) {
      fundList.push({
        'code': n[0].trim(),
        'name': n[1].trim(),
        'fee': parseFloat(n[20].trim()) / 100 || defaultFee,
        'fee_tiantian': parseFloat(n[17].trim()) / 100 || defaultFee / 10,
        'available': !_.isEmpty(n[3])
      });
    });

    callback(fundList);
  });
}

function fetchFundData(code, callback) {
  sa.get('http://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=' + code + '&page=1&per=5000&sdate=&edate=').charset('gbk').end(function (err, res) {
    if (err) {
      return;
    }

    eval(res.text);

    var $ = cheerio.load(apidata.content);

    var tickets = [];
    $('tbody tr').each(function (idx, row) {
      var tds = $(row).children('td');
      function getTdData(idx) {
        return tds.eq(idx).text().trim();
      }
      tickets.push(normalizeData(getTdData(0), getTdData(1), getTdData(2), getTdData(3), getTdData(4), getTdData(5), getTdData(6)));
    });

    callback(tickets);
  });
}