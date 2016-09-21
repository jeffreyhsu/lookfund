
import * as axios from 'axios';
import * as vm from 'vm';
import * as _ from 'lodash-node';
import {mongoskin} from './async_mongoskin';
import * as cheerio from 'cheerio';
import * as iconv from 'iconv-lite';

async function fetchFundList() {
  // fetch page content from fund list
  const LIST_URL = 'http://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page=1,9999&dt=1462091017630&atfc=&onlySale=0';
  let response = await axios.get(LIST_URL);
  if (response.status !== 200) {
    throw new Error(`[${response.status}] Page(${LIST_URL}) cannot access`);
  }

  // parse data from page content
  let context = {};
  new vm.Script(response.data).runInNewContext(context);
  let fundList = []
  const DEFAULT_FEE = 0.015

  for (let n of Array.from(context.db.datas).values()) {
    fundList.push({
      'code': n[0].trim(),
      'name': n[1].trim(),
      'fee': Number.parseFloat(n[20].trim()) / 100 || DEFAULT_FEE,
      'fee_tiantian': Number.parseFloat(n[17].trim()) / 100 || (DEFAULT_FEE / 10),
      'available': !_.isEmpty(n[3])
    })
  }

  return fundList;
}

async function fetchFundDetail(code) {
  const DETAIL_URL = 'http://fund.eastmoney.com/';
  const JJFL_URL = 'http://fund.eastmoney.com/f10/jjfl';
  try {
    // basic information
    let info = {};
    let response = await axios.get(DETAIL_URL + code + '.html');
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
    info.risk = risk;

    // buy information
    const BUY_INFO_MAP = {'支持':true, '不支持':false};
    let tryCount = 0;
    let responseBuyPage = await axios.get('http://fund.eastmoney.com/f10/jjfl_'+code+'.html', { responseType: 'arraybuffer' });
    var data = iconv.decode(responseBuyPage.data, 'gb2312');
    let buyInfo = {};
    let $buy = cheerio.load(data)
    let fixedStatusTxt = $buy('table.w770').find('tbody tr td.w135').eq(2).text()
    buyInfo.fixed_invest = BUY_INFO_MAP[fixedStatusTxt]
    // if (typeof info.fixed_invest === 'undefined' && ++tryCount < 5) {
      // 读取失败，重新加载
      // getPage()
    // }
    console.log(buyInfo);

    // let buyInfo = await new Promise(function(resolve, reject) {
    //   const BUY_INFO_MAP = {'支持':true, '不支持':false}
    //   let tryCount = 0
    //   function getPage() {
    //     sa.get('http://fund.eastmoney.com/f10/jjfl_'+code+'.html').charset('gbk')
    //     .end(function(err, res) {
    //       if (!res) {
    //         reject()
    //         return
    //       }
    //       if (err) {
    //         reject(err)
    //       }
    //       let info = {}
    //       let $ = cheerio.load(res.text)
    //
    //       let fixedStatusTxt = $('table.w770').find('tbody tr td.w135').eq(2).text()
    //
    //       info.fixed_invest = BUY_INFO_MAP[fixedStatusTxt]
    //
    //       if (typeof info.fixed_invest === 'undefined' && ++tryCount < 5) {
    //         // 读取失败，重新加载
    //           getPage()
    //       }
    //       resolve(info)
    //     })
    //   }
    //   getPage()
    // })
    // detail = _.extend(basic, buyInfo, detail)
    // resolve(detail)

  // } catch (e) {
  //   console.error(e)
  //   reject(e)
  // }




  } catch (e) {
    console.error(e)
    throw e;
  }
  return info;
}

async function process() {
  let d = await fetchFundDetail('000011')
  console.log(d)
  // let db = mongoskin.db('mongodb://localhost:27017/lookfund', {native_parser:true});
  // db.bind('funds');
  //
  // let fetchedFundList = await fetchFundList();
  // await db.funds.deleteManyAsync({});
  // await db.funds.insertManyAsync(fetchedFundList);
  //
  // db.close();
}
process();

// function fetchFundList() {
//   return new Promise(function(resolve, reject) {
//     sa.get('http://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page=1,9999&dt=1462091017630&atfc=&onlySale=0')
//       .end(function(err, res) {
//
//         if (err) {
//           reject(err)
//         }
//
//         let context = {}
//         new vm.Script(res.text).runInNewContext(context)
//
//         var fundList = []
//         const defaultFee = 0.015
//         context.db.datas.forEach(function(n, i) {
//           fundList.push({
//             'code': n[0].trim(),
//             'name': n[1].trim(),
//             'fee': Number.parseFloat(n[20].trim()) / 100 || defaultFee,
//             'fee_tiantian': Number.parseFloat(n[17].trim()) / 100 || (defaultFee / 10),
//             'available': !_.isEmpty(n[3])
//           })
//         })
//
//         resolve(fundList)
//
//       })
//   })
//
// }
