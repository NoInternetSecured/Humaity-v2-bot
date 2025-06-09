const axios = require('axios');
const fs = require('fs');
const { ZSTDDecoder } = require('zstddec');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');
const geoip = require('geoip-lite');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS] ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}[WARN] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[ERROR] ${msg}${colors.reset}`),
  debug: (msg) => console.log(`${colors.blue}[DEBUG] ${msg}${colors.reset}`),
  referral: (msg) => console.log(`${colors.green}[REFERRAL] ${msg}${colors.reset}`),
  claim: (msg) => console.log(`${colors.green}[CLAIM] ${msg}${colors.reset}`),
  profile: (msg) => console.log(`${colors.cyan}[PROFILE] ${msg}${colors.reset}`),
  countdown: (msg) => console.log(`${colors.magenta}[COUNTDOWN] ${msg}${colors.reset}`)
};

const LANGUAGE_MAP = {
  'US': 'en-US,en;q=0.9',
  'GB': 'en-GB,en;q=0.9',
  'JP': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
  'ID': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'DE': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'FR': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'KR': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'BR': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'default': 'en-US,en;q=0.9'
};

const USER_AGENTS = {
  'Windows': [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
  ],
  'Mac': [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15'
  ],
  'iPhone': [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ]
};

// Global variables for activity tracking
let lastActivityTimestamp = Date.now();
let isInDelay = false;
let isInCountdown = false;
let countdownInterval;

// Function to update last activity timestamp
function updateActivity() {
  if (!isInCountdown) { // Only update if not in countdown
    lastActivityTimestamp = Date.now();
  }
}

// Freeze detection function
function checkForFreeze() {
  if (isInDelay || isInCountdown) return false; // Ignore freeze check during delays or countdown
  
  const now = Date.now();
  const inactiveDuration = now - lastActivityTimestamp;
  const freezeThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds

  if (inactiveDuration > freezeThreshold) {
    log.error(`Freeze detected! No activity for ${Math.floor(inactiveDuration/1000)} seconds. Continuing to next process...`);
    return true;
  }
  return false;
}

async function initializeZstd() {
  const zstd = new ZSTDDecoder();
  await zstd.init();
  return zstd;
}

function getProxyCountry(proxy) {
  try {
    const ipMatch = proxy.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    if (ipMatch) {
      const geo = geoip.lookup(ipMatch[0]);
      return geo?.country || 'US';
    }
  } catch (e) {
    return 'US';
  }
  return 'US';
}

function getUserAgent(country) {
  let device;
  if (country === 'JP' && Math.random() > 0.5) {
    device = 'iPhone';
  } else {
    device = Math.random() > 0.5 ? 'Windows' : 'Mac';
  }
  const agents = USER_AGENTS[device];
  return agents[Math.floor(Math.random() * agents.length)];
}

function getSecChUa(userAgent) {
  if (userAgent.includes('Chrome')) {
    return '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"';
  } else if (userAgent.includes('Firefox')) {
    return '"Firefox";v="125"';
  } else if (userAgent.includes('Safari')) {
    return '"Safari";v="605"';
  }
  return '"Not.A/Brand";v="99"';
}

async function humanDelay(min = 500, max = 30000) {
  isInDelay = true;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
  isInDelay = false;
  updateActivity();
}

async function getNewSession(proxy, userAgent, acceptLanguage, retryCount = 0) {
  const maxRetries = 3;
  const baseTimeout = 10000;
  const httpsAgent = new HttpsProxyAgent(proxy);
  
  try {
    updateActivity();
    const response = await axios.get('https://testnet.humanity.org/login', {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': acceptLanguage
      },
      httpsAgent,
      timeout: baseTimeout * (retryCount + 1) 
    });
    
    const cookies = response.headers['set-cookie'];
    return cookies ? cookies.join('; ') : '';
    
  } catch (error) {
    if (retryCount < maxRetries - 1) {
      const nextRetry = retryCount + 1;
      const delayTime = (nextRetry * 2000) + Math.random() * 3000;
      
      log.warning(`[Retry ${nextRetry}] Failed to get new session (${error.message}), retrying in ${Math.round(delayTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayTime));
      updateActivity();
      
      return getNewSession(proxy, userAgent, acceptLanguage, nextRetry);
    } else {
      log.error('Max retries reached for getting new session:', error.message);
      return '';
    }
  }
}

async function makeRequest(zstd, config, retryCount = 0) {
  const maxRetries = 3;
  const baseTimeout = 10000;
  const httpsAgent = new HttpsProxyAgent(config.proxy);
  let cookie = config.cookie;

  if (!cookie || Math.random() > 0.8) {
    log.info(`${config.userId} - Renewing session...`);
    cookie = await getNewSession(config.proxy, config.userAgent, config.acceptLanguage);
    if (!cookie) {
      if (retryCount < maxRetries - 1) {
        return makeRequest(zstd, config, retryCount + 1);
      }
      return false;
    }
    config.cookie = cookie; 
  }

  try {
    await humanDelay();

    if (Math.random() > 0.7) {
      updateActivity();
      await axios.get('https://testnet.humanity.org/api/config', {
        headers: {
          'User-Agent': config.userAgent,
          'Cookie': cookie,
          'Accept-Language': config.acceptLanguage
        },
        httpsAgent,
        timeout: 5000 * (retryCount + 1)
      });
      await humanDelay(500, 2000);
    }

    const secChUa = getSecChUa(config.userAgent);
    const platform = config.userAgent.includes('Windows') ? '"Windows"' : 
                    config.userAgent.includes('Mac') ? '"macOS"' : 
                    config.userAgent.includes('iPhone') ? '"iOS"' : '"Android"';

    updateActivity();
    const response = await axios({
      method: 'post',
      url: 'https://testnet.humanity.org/api/user/userInfo',
      headers: {
        'authority': 'testnet.humanity.org',
        'accept': 'application/json, text/plain, */*',
        'accept-language': config.acceptLanguage,
        'authorization': `Bearer ${config.token}`,
        'content-type': 'application/json',
        'cookie': cookie,
        'origin': 'https://testnet.humanity.org',
        'priority': 'u=1, i',
        'referer': 'https://testnet.humanity.org/dashboard',
        'sec-ch-ua': secChUa,
        'sec-ch-ua-mobile': config.userAgent.includes('Mobile') ? '?1' : '?0',
        'sec-ch-ua-platform': platform,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'token': config.token,
        'user-agent': config.userAgent,
        'x-mouse-movement': `x: ${Math.floor(Math.random() * 1000)}, y: ${Math.floor(Math.random() * 1000)}`,
        'x-scroll-position': `y=${Math.floor(Math.random() * 5000)}`,
        'x-requested-with': 'XMLHttpRequest'
      },
      data: {},
      responseType: 'arraybuffer',
      httpsAgent,
      timeout: Math.floor(Math.random() * 5000) + (baseTimeout * (retryCount + 1))
    });

    let responseData;
    if (response.headers['content-encoding'] === 'zstd') {
      responseData = JSON.parse((await zstd.decode(Buffer.from(response.data))).toString());
    } else {
      responseData = JSON.parse(response.data.toString());
    }

    if (responseData?.code === 0) {
      log.profile(`\n${config.userId} - User Info`);
      log.profile('Nick Name: ' + responseData.data.nickName);
      log.profile('Balance: ' + JSON.stringify({
        total_rewards: responseData.data.balance.total_rewards,
        daily_rewards: responseData.data.balance.daily_rewards,
        referral_rewards_today: responseData.data.balance.referral_rewards_today
      }, null, 2));
      return true;
    } else {
      log.error(`${config.userId} Error: ${responseData?.msg || 'Unknown error'}`);
      if (retryCount < maxRetries - 1) {
        return makeRequest(zstd, config, retryCount + 1);
      }
      return false;
    }
  } catch (error) {
    log.error(`${config.userId} Failed (Attempt ${retryCount + 1}): ${error.message}`);
    if (retryCount < maxRetries - 1) {
      const delayTime = (retryCount * 3000) + Math.random() * 5000;
      log.warning(`Retrying in ${Math.round(delayTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayTime));
      updateActivity();
      return makeRequest(zstd, config, retryCount + 1);
    }
    return false;
  }
}

async function checkReferralRewards(zstd, config, retryCount = 0) {
  const maxRetries = 3;
  const baseTimeout = 10000;
  const httpsAgent = new HttpsProxyAgent(config.proxy);
  let cookie = config.cookie;

  if (!cookie || Math.random() > 0.8) {
    log.info(`${config.userId} - Renewing session...`);
    cookie = await getNewSession(config.proxy, config.userAgent, config.acceptLanguage);
    if (!cookie) {
      if (retryCount < maxRetries - 1) {
        return checkReferralRewards(zstd, config, retryCount + 1);
      }
      return null;
    }
    config.cookie = cookie;
  }

  try {
    await humanDelay();

    const secChUa = getSecChUa(config.userAgent);
    const platform = config.userAgent.includes('Windows') ? '"Windows"' : 
                    config.userAgent.includes('Mac') ? '"macOS"' : 
                    config.userAgent.includes('iPhone') ? '"iOS"' : '"Android"';

    updateActivity();
    const response = await axios({
      method: 'post',
      url: 'https://testnet.humanity.org/api/rewards/referral/check',
      headers: {
        'authority': 'testnet.humanity.org',
        'accept': 'application/json, text/plain, */*',
        'accept-language': config.acceptLanguage,
        'authorization': `Bearer ${config.token}`,
        'content-type': 'application/json',
        'cookie': cookie,
        'origin': 'https://testnet.humanity.org',
        'priority': 'u=1, i',
        'referer': 'https://testnet.humanity.org/dashboard',
        'sec-ch-ua': secChUa,
        'sec-ch-ua-mobile': config.userAgent.includes('Mobile') ? '?1' : '?0',
        'sec-ch-ua-platform': platform,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'token': config.token,
        'user-agent': config.userAgent,
        'x-mouse-movement': `x: ${Math.floor(Math.random() * 1000)}, y: ${Math.floor(Math.random() * 1000)}`,
        'x-scroll-position': `y=${Math.floor(Math.random() * 5000)}`,
        'x-requested-with': 'XMLHttpRequest'
      },
      data: {},
      responseType: 'arraybuffer',
      httpsAgent,
      timeout: baseTimeout * (retryCount + 1)
    });

    let responseData;
    if (response.headers['content-encoding'] === 'zstd') {
      responseData = JSON.parse((await zstd.decode(Buffer.from(response.data))).toString());
    } else {
      responseData = JSON.parse(response.data.toString());
    }

    log.referral(`\n${config.userId} - Daily Referral Rewards Check`);
    log.referral('Status: ' + responseData.message);
    log.referral('Available: ' + responseData.available);
    if (responseData.amount) log.referral('Amount: ' + responseData.amount);
    if (responseData.next_daily_award) log.referral('Next Award: ' + responseData.next_daily_award);

    return responseData;

  } catch (error) {
    log.error(`[${config.userId}] Failed (Attempt ${retryCount + 1}): ${error.message}`);
    if (retryCount < maxRetries - 1) {
      const delayTime = (retryCount * 3000) + Math.random() * 5000;
      log.warning(`Retrying in ${Math.round(delayTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayTime));
      updateActivity();
      return checkReferralRewards(zstd, config, retryCount + 1);
    }
    log.error(`[${config.userId}] Max retries reached`);
    return null;
  }
}

async function checkAndClaimDailyRewards(zstd, config, retryCount = 0) {
  const maxRetries = 3;
  const baseTimeout = 10000;
  const httpsAgent = new HttpsProxyAgent(config.proxy);
  let cookie = config.cookie;

  if (!cookie || Math.random() > 0.8) {
    log.info(`${config.userId} - Renewing session...`);
    cookie = await getNewSession(config.proxy, config.userAgent, config.acceptLanguage);
    if (!cookie) {
      if (retryCount < maxRetries - 1) {
        return checkAndClaimDailyRewards(zstd, config, retryCount + 1);
      }
      return null;
    }
    config.cookie = cookie;
  }

  try {
    await humanDelay();

    const secChUa = getSecChUa(config.userAgent);
    const platform = config.userAgent.includes('Windows') ? '"Windows"' : 
                    config.userAgent.includes('Mac') ? '"macOS"' : 
                    config.userAgent.includes('iPhone') ? '"iOS"' : '"Android"';

    updateActivity();
    const checkResponse = await axios({
      method: 'post',
      url: 'https://testnet.humanity.org/api/rewards/daily/check',
      headers: {
        'authority': 'testnet.humanity.org',
        'accept': 'application/json, text/plain, */*',
        'accept-language': config.acceptLanguage,
        'authorization': `Bearer ${config.token}`,
        'content-type': 'application/json',
        'cookie': cookie,
        'origin': 'https://testnet.humanity.org',
        'priority': 'u=1, i',
        'referer': 'https://testnet.humanity.org/dashboard',
        'sec-ch-ua': secChUa,
        'sec-ch-ua-mobile': config.userAgent.includes('Mobile') ? '?1' : '?0',
        'sec-ch-ua-platform': platform,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'token': config.token,
        'user-agent': config.userAgent,
        'x-mouse-movement': `x: ${Math.floor(Math.random() * 1000)}, y: ${Math.floor(Math.random() * 1000)}`,
        'x-scroll-position': `y=${Math.floor(Math.random() * 5000)}`,
        'x-requested-with': 'XMLHttpRequest'
      },
      data: {},
      responseType: 'arraybuffer',
      httpsAgent,
      timeout: baseTimeout * (retryCount + 1)
    });

    let checkData;
    if (checkResponse.headers['content-encoding'] === 'zstd') {
      checkData = JSON.parse((await zstd.decode(Buffer.from(checkResponse.data))).toString());
    } else {
      checkData = JSON.parse(checkResponse.data.toString());
    }

    log.claim(`\n${config.userId} - Daily Rewards Check`);
    log.claim('Status: ' + checkData.message);
    log.claim('Available: ' + checkData.available);
    if (checkData.amount) log.claim('Amount: ' + checkData.amount);
    if (checkData.next_daily_award) log.claim('Next Award: ' + checkData.next_daily_award);

    if (checkData.available === true) {
      log.info(`${config.userId} - Attempting to claim daily rewards...`);
      await humanDelay(2000, 5000);
      
      updateActivity();
      const claimResponse = await axios({
        method: 'post',
        url: 'https://testnet.humanity.org/api/rewards/daily/claim',
        headers: {
          'authority': 'testnet.humanity.org',
          'accept': 'application/json, text/plain, */*',
          'accept-language': config.acceptLanguage,
          'authorization': `Bearer ${config.token}`,
          'content-type': 'application/json',
          'cookie': cookie,
          'origin': 'https://testnet.humanity.org',
          'priority': 'u=1, i',
          'referer': 'https://testnet.humanity.org/dashboard',
          'sec-ch-ua': secChUa,
          'sec-ch-ua-mobile': config.userAgent.includes('Mobile') ? '?1' : '?0',
          'sec-ch-ua-platform': platform,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'token': config.token,
          'user-agent': config.userAgent,
          'x-mouse-movement': `x: ${Math.floor(Math.random() * 1000)}, y: ${Math.floor(Math.random() * 1000)}`,
          'x-scroll-position': `y=${Math.floor(Math.random() * 5000)}`,
          'x-requested-with': 'XMLHttpRequest'
        },
        data: {},
        responseType: 'arraybuffer',
        httpsAgent,
        timeout: baseTimeout * (retryCount + 1)
      });

      let claimData;
      if (claimResponse.headers['content-encoding'] === 'zstd') {
        claimData = JSON.parse((await zstd.decode(Buffer.from(claimResponse.data))).toString());
      } else {
        claimData = JSON.parse(claimResponse.data.toString());
      }

      log.success(`${config.userId} - Claim Daily Results`);
      log.success('Status: ' + claimData.message);
      if (claimData.amount) log.success('Claimed Amount: ' + claimData.amount);
      if (claimData.next_daily_award) log.success('Next Award: ' + claimData.next_daily_award);

      return claimData;
    }

    return checkData;

  } catch (error) {
    log.error(`[${config.userId}] Failed (Attempt ${retryCount + 1}): ${error.message}`);
    if (retryCount < maxRetries - 1) {
      const delayTime = (retryCount * 3000) + Math.random() * 5000;
      log.warning(`Retrying in ${Math.round(delayTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayTime));
      updateActivity();
      return checkAndClaimDailyRewards(zstd, config, retryCount + 1);
    }
    log.error(`[${config.userId}] Max retries reached`);
    return null;
  }
}

async function readConfigFile(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const configs = [];
  for await (const line of rl) {
    if (!line.trim() || line.startsWith('#')) continue;
    
    const [proxy, token, cookie] = line.split('|').map(item => item.trim());
    if (proxy && token) {
      const country = getProxyCountry(proxy);
      const userAgent = getUserAgent(country);
      const acceptLanguage = LANGUAGE_MAP[country] || LANGUAGE_MAP.default;
      
      configs.push({
        proxy,
        token,
        cookie: cookie || '',
        userId: token.substring(token.length - 6),
        country,
        userAgent,
        acceptLanguage
      });
    }
  }
  return configs;
}

function startCountdown(duration) {
  isInCountdown = true;
  let remaining = duration;
  
  // Display initial countdown
  displayCountdown(remaining);
  
  countdownInterval = setInterval(() => {
    remaining -= 1000;
    displayCountdown(remaining);
    
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      isInCountdown = false;
      updateActivity(); // Update activity as we exit countdown
    }
  }, 1000);
}

function displayCountdown(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  
  log.countdown(`Next run in: ${hours}h ${minutes}m ${seconds}s`);
}

async function runBotCycle() {
  try {
    console.log('=== Humanity Testnet Bot ===\n');
    const zstd = await initializeZstd();
    const configs = await readConfigFile('config.txt');
    
    if (configs.length === 0) {
      log.error('Error: No valid configurations in config.txt');
      log.error('Format: proxy|token|cookie');
      process.exit(1);
    }

    log.info(`Loaded ${configs.length} configurations`);
    
    for (const config of configs) {
      try {
        updateActivity();
        await makeRequest(zstd, config);
        if (checkForFreeze()) continue;
        
        await humanDelay(1000, 10000);
        if (checkForFreeze()) continue;
        
        updateActivity();
        await checkAndClaimDailyRewards(zstd, config);
        if (checkForFreeze()) continue;
        
        await humanDelay(1000, 10000);
        if (checkForFreeze()) continue;
        
        updateActivity();
        await checkReferralRewards(zstd, config);
        if (checkForFreeze()) continue;
        
        await humanDelay(1000, 10000);
      } catch (err) {
        log.error(`Error processing config ${config.userId}: ${err.message}`);
        continue;
      }
    }

    log.success('Cycle completed successfully. Starting countdown for next run...');
  } catch (err) {
    log.error('Error during bot cycle: ' + err.message);
  }
}

// Main execution loop
(async () => {
  const RUN_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
  const FREEZE_CHECK_INTERVAL = 60 * 1000; // 1 minute in milliseconds

  // Start freeze detection monitor
  setInterval(() => {
    checkForFreeze(); // Just detect, don't exit
  }, FREEZE_CHECK_INTERVAL);

  // Initial run
  await runBotCycle();
  
  // Start the countdown immediately after first run
  startCountdown(RUN_INTERVAL);

  // Schedule periodic runs
  setInterval(async () => {
    await runBotCycle();
    startCountdown(RUN_INTERVAL); // Restart countdown after each run
  }, RUN_INTERVAL);
})();
