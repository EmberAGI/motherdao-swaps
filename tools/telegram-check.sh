#!/bin/bash

# Simple script to test Telegram API connectivity

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENV_FILE="$SCRIPT_DIR/../.env"

echo -e "${YELLOW}⏳ Testing connection to Telegram API...${NC}"
echo -e "Looking for .env file at: $ENV_FILE"

# Get bot token from .env file
if [ -f "$ENV_FILE" ]; then
  TOKEN=$(grep -m 1 "TELEGRAM_BOT_TOKEN" "$ENV_FILE" | cut -d '=' -f2)
else
  echo -e "${RED}❌ .env file not found at $ENV_FILE${NC}"
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ TELEGRAM_BOT_TOKEN not found in .env file${NC}"
  exit 1
fi

# Test 1: getMe
echo -e "\n${YELLOW}1️⃣ Testing getMe endpoint...${NC}"
GET_ME_RESPONSE=$(curl -s -m 15 https://api.telegram.org/bot$TOKEN/getMe)

if [[ $GET_ME_RESPONSE == *"\"ok\":true"* ]]; then
  USERNAME=$(echo $GET_ME_RESPONSE | grep -o '"username":"[^"]*"' | cut -d '"' -f4)
  echo -e "${GREEN}✅ Successfully connected to getMe endpoint${NC}"
  echo -e "   Bot username: $USERNAME"
else
  echo -e "${RED}❌ Failed to connect to getMe endpoint:${NC}"
  echo "$GET_ME_RESPONSE"
  echo -e "\n${YELLOW}Checking connectivity to Telegram API servers...${NC}"
  ping -c 3 api.telegram.org
  exit 1
fi

# Test 2: getWebhookInfo
echo -e "\n${YELLOW}2️⃣ Testing getWebhookInfo endpoint...${NC}"
WEBHOOK_RESPONSE=$(curl -s -m 15 https://api.telegram.org/bot$TOKEN/getWebhookInfo)

if [[ $WEBHOOK_RESPONSE == *"\"ok\":true"* ]]; then
  WEBHOOK_URL=$(echo $WEBHOOK_RESPONSE | grep -o '"url":"[^"]*"' | cut -d '"' -f4)
  echo -e "${GREEN}✅ Successfully got webhook info:${NC}"
  echo -e "   Current webhook URL: ${WEBHOOK_URL:-None}"
else
  echo -e "${RED}❌ Failed to get webhook info:${NC}"
  echo "$WEBHOOK_RESPONSE"
fi

# Get ngrok URL from .env
NGROK_URL=$(grep -m 1 "NGROK_URL" "$ENV_FILE" | cut -d '=' -f2)

if [ ! -z "$NGROK_URL" ]; then
  echo -e "\n${YELLOW}3️⃣ Testing webhook accessibility...${NC}"
  WEBHOOK_PATH="$NGROK_URL/telegram/webhook"
  WEBHOOK_TEST=$(curl -s -o /dev/null -w "%{http_code}" "$WEBHOOK_PATH")
  
  if [[ $WEBHOOK_TEST == "200" || $WEBHOOK_TEST == "400" ]]; then
    echo -e "${GREEN}✅ Webhook endpoint is accessible (status code: $WEBHOOK_TEST)${NC}"
  else
    echo -e "${RED}❌ Webhook endpoint is NOT accessible (status code: $WEBHOOK_TEST)${NC}"
    echo -e "   URL tested: $WEBHOOK_PATH"
  fi
else
  echo -e "\n${YELLOW}⚠️ NGROK_URL not found in .env, skipping webhook accessibility test${NC}"
fi

echo -e "\n${GREEN}🎉 Telegram API connectivity test completed!${NC}"

# Run a specific test for the setMyCommands endpoint
echo -e "\n${YELLOW}4️⃣ Testing setMyCommands (the problematic endpoint)...${NC}"
SET_COMMANDS_RESPONSE=$(curl -s -m 20 -X POST https://api.telegram.org/bot$TOKEN/setMyCommands \
  -H "Content-Type: application/json" \
  -d '{"commands":[{"command":"test","description":"Test command"}]}')

if [[ $SET_COMMANDS_RESPONSE == *"\"ok\":true"* ]]; then
  echo -e "${GREEN}✅ Successfully set bot commands${NC}"
else
  echo -e "${RED}❌ Failed to set bot commands:${NC}"
  echo "$SET_COMMANDS_RESPONSE"
  
  echo -e "\n${YELLOW}Troubleshooting recommendations:${NC}"
  echo -e "  1. Try on a different network (e.g. mobile hotspot)"
  echo -e "  2. Use a VPN to bypass potential blocks"
  echo -e "  3. Check if your router/firewall has strict settings"
  echo -e "  4. Your ISP might be throttling connections to Telegram API"
fi

exit 0 