// Simple script to test Telegram API connectivity
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Read .env file
function readEnvVar(varName) {
  try {
    const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
    const match = new RegExp(`${varName}=(.*)`, 'i').exec(envContent);
    return match ? match[1].trim() : null;
  } catch (err) {
    console.error('Failed to read .env file:', err.message);
    return null;
  }
}

// Make HTTPS request to Telegram API
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 10000 // 10 second timeout
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const responseData = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: responseData });
        } catch (err) {
          reject(new Error(`Failed to parse response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// Main function
async function checkTelegramAPI() {
  console.log('⏳ Testing connection to Telegram API...');
  
  // Get bot token from .env file
  const token = readEnvVar('TELEGRAM_BOT_TOKEN');
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found in .env file');
    process.exit(1);
  }
  
  try {
    // Test 1: getMe
    console.log('1️⃣ Testing getMe endpoint...');
    const getMeUrl = `https://api.telegram.org/bot${token}/getMe`;
    const getMeResponse = await makeRequest(getMeUrl);
    
    if (getMeResponse.statusCode === 200 && getMeResponse.data.ok) {
      console.log('✅ Successfully connected to getMe endpoint');
      console.log('   Bot username:', getMeResponse.data.result.username);
    } else {
      console.error('❌ Failed to connect to getMe endpoint:', getMeResponse.data);
      throw new Error('API returned error');
    }
    
    // Test 2: getWebhookInfo
    console.log('\n2️⃣ Testing getWebhookInfo endpoint...');
    const getWebhookUrl = `https://api.telegram.org/bot${token}/getWebhookInfo`;
    const webhookResponse = await makeRequest(getWebhookUrl);
    
    if (webhookResponse.statusCode === 200 && webhookResponse.data.ok) {
      console.log('✅ Successfully got webhook info:');
      console.log('   Current webhook URL:', webhookResponse.data.result.url || 'None');
    } else {
      console.error('❌ Failed to get webhook info:', webhookResponse.data);
    }
    
    console.log('\n🎉 Telegram API connectivity test completed successfully!');
  } catch (error) {
    console.error('\n❌ Error testing Telegram API:');
    console.error('  Error message:', error.message);
    
    if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
      console.error('\n  This is a network timeout error.');
      console.error('  Likely causes:');
      console.error('   1. Your internet connection is slow or unstable');
      console.error('   2. There may be a firewall or proxy blocking access to api.telegram.org');
      console.error('   3. Your ISP might be throttling or blocking Telegram API');
      console.error('\n  Recommendations:');
      console.error('   - Try a different network (e.g. mobile hotspot)');
      console.error('   - Use a VPN to bypass potential blocks');
      console.error('   - Check if your router/firewall has strict settings');
    }
  }
  
  process.exit(0);
}

// Run the test
checkTelegramAPI(); 