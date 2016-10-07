
let axios = require('axios');
let iconv = require('iconv-lite');

async function fetch(url, config={}, encoding='utf8', retryConfig={maxAttempts:10, retryDelay:3000}) {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  let response;
  let decode = encoding.toLowerCase() !== 'utf8';
  if (decode) {
    config.responseType = 'arraybuffer';
  }

  for (let i = 1; i <= retryConfig.maxAttempts; i++) {
    try {
      response = await axios.get(url, config);
      if (response.status === 200 && response.data) {
          response.data = decode ? iconv.decode(response.data, encoding) : response.data;
        break;
      }
    } catch (e) {
      console.error(e);
    }
    console.log(`Retry ${i}`);
    // sleep(retryConfig.retryDelay);
  }
  return response;
}

module.exports = fetch;
