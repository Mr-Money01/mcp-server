# @mrmonei/mcp-server

MCP server for the [Monei](https://monei.cc) API. Gives any AI agent access to wallets, transfers, crypto sends, swaps, offramp, and bill payments through natural language.

Works with Claude Desktop, Cursor, and any MCP compatible agent platform.

---

## Quick start

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "monei": {
      "command": "npx",
      "args": ["-y", "@mrmonei/mcp-server"],
      "env": {
        "MONEI_API_KEY": "your_api_key_here",
      }
    }
  }
}
```

Restart Claude Desktop. You should see the Monei tools available in the tools menu.

### Cursor (local)

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "monei": {
      "command": "npx",
      "args": ["-y", "@mrmonei/mcp-server"],
      "env": {
        "MONEI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Cursor (remote via Railway)

```json
{
  "mcpServers": {
    "monei": {
      "url": "https://mcp.monei.cc/sse",
      "headers": {
        "Authorization": "Bearer your_api_key_here"
      }
    }
  }
}
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONEI_API_KEY` | Yes (stdio) | — | Your Monei API key. Not required in HTTP/SSE mode — pass via `Authorization: Bearer` header instead |
| `MONEI_TRANSPORT` | No | `stdio` | Transport mode: `stdio`, `http`, or `sse` |
| `PORT` | No | `3000` | HTTP/SSE server port |
| `MONEI_TIMEOUT` | No | `30000` | Request timeout in milliseconds. Max 120000 |
| `MONEI_API_URL` | No | `https://api.monei.cc` | Override the live API base URL |

---

## Transport modes

| Mode | Use case | How to start |
|---|---|---|
| `stdio` | Claude Desktop, local Cursor | Default — just run the server |
| `http` | Custom agents, API integrations | `MONEI_TRANSPORT=http node dist/index.js` |
| `sse` | Cursor remote, Claude.ai | `MONEI_TRANSPORT=sse node dist/index.js` |

In `http` and `sse` modes the server is stateless and multi-user. Each client passes their own API key via `Authorization: Bearer <key>`. One deployed server serves many users.

---

## Tool reference

### Account

#### `monei_get_account`
Returns the authenticated user's profile.

**Inputs:** none

**Returns:**
```json
{
  "id": "string",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "phone": "string"
}
```

**Example prompt:** *"Who am I logged in as?"*

---

### Wallet

#### `monei_get_wallet`
Returns NGN balance and all subwallets.

**Inputs:** none

**Returns:**
```json
{
  "ngnBalance": "number",
  "subWallets": [{ "id": "string", "type": "string", "balance": "number" }]
}
```

**Example prompt:** *"What's my wallet balance?"*

---

#### `monei_get_evm_portfolio`
Returns the full token portfolio for an EVM chain including USD values.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `chainId` | number | Yes | Chain ID. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum |

**Example prompt:** *"What tokens do I have on Base?"*

---

#### `monei_get_solana_portfolio`
Returns SOL and all SPL token balances with USD values.

**Inputs:** none

**Example prompt:** *"Show my Solana wallet"*

---

#### `monei_get_my_solana_address`
Returns the user's Solana wallet address.

**Inputs:** none

**Example prompt:** *"What's my Solana address? I want to receive SOL."*

---

#### `monei_get_supported_networks`
Lists all supported EVM chains with chain IDs and names.

**Inputs:** none

**Example prompt:** *"What chains do you support?"*

---

### Deposits

#### `monei_generate_deposit_link`
Generates a payment link the user can open to deposit NGN.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number | Yes | Amount in NGN to deposit |

**Returns:**
```json
{
  "paymentLink": "string",
  "reference": "string"
}
```

**Example prompt:** *"I want to deposit ₦50,000 into my Monei account"*

---

#### `monei_check_deposit_status`
Checks the status of a deposit by reference.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `reference` | string | Yes | Reference from `monei_generate_deposit_link` |

**Example prompt:** *"Did my deposit go through?"*

---

### NGN Payouts

#### `monei_send_naira_to_bank`
Sends NGN to a Nigerian bank account.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number | Yes | Amount in NGN |
| `bankCode` | string | Yes | Bank code from `monei_get_banks` |
| `accountNumber` | string | Yes | 10-digit account number |
| `transactionPin` | string | Yes | User's 4-6 digit transaction PIN |
| `narration` | string | No | Transfer description |

> Always call `monei_verify_bank_account` first and show the account name to the user before sending.

**Example prompt:** *"Send ₦20,000 to my GTBank account 0123456789"*

---

#### `monei_send_naira_to_user`
Sends NGN to another Monei user by email or phone.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `receiver` | string | Yes | Recipient email or phone number |
| `amount` | number | Yes | Amount in NGN |
| `transactionPin` | string | Yes | User's 4-6 digit transaction PIN |

**Example prompt:** *"Send ₦5,000 to john@gmail.com"*

---

### Banking utilities

#### `monei_get_banks`
Returns the full list of supported Nigerian banks with their codes.

**Inputs:** none

**Example prompt:** *"What banks do you support?"* / *"What's the bank code for GTBank?"*

---

#### `monei_verify_bank_account`
Verifies a bank account number and returns the account holder name.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `accountNumber` | string | Yes | 10-digit bank account number |
| `bankCode` | string | Yes | Bank code from `monei_get_banks` |

**Returns:**
```json
{
  "accountName": "string",
  "accountNumber": "string",
  "bankCode": "string"
}
```

> Always call this before any bank payout and show the account name to the user for confirmation.

**Example prompt:** *"Verify account 0123456789 at GTBank"*

---

### Crypto sends

#### `monei_send_crypto_evm`
Sends native tokens or ERC-20s on any supported EVM chain.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `to` | string | Yes | Recipient wallet address (0x...) |
| `amount` | string | Yes | Amount to send as a string (e.g. "0.1") |
| `chainId` | number | Yes | Chain ID |
| `tokenAddress` | string | No | ERC-20 contract address. Omit for native token sends |

**Example prompts:**
- *"Send 0.01 ETH to 0x742d..."*
- *"Send 100 USDT on BSC to 0x..."*

---

#### `monei_send_crypto_solana`
Sends SOL or SPL tokens on Solana.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `to` | string | Yes | Recipient Solana address |
| `amount` | string | Yes | Amount to send |
| `tokenMintAddress` | string | No | SPL token mint address. Omit for SOL sends |

**Example prompts:**
- *"Send 2 SOL to 5AH3..."*
- *"Send 50 USDC on Solana to 5AH3..."*

---

### Token swaps

#### `monei_swap_tokens_evm`
Swaps tokens on EVM. Routes automatically based on whether tokens are native or ERC-20.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | string | Yes | Amount to swap |
| `chainId` | number | Yes | Chain ID |
| `tokenIn` | string | No | ERC-20 contract to sell. Omit when selling native token |
| `tokenOut` | string | No | ERC-20 contract to buy. Omit when buying native token |
| `slippageBps` | number | No | Slippage tolerance in basis points. Default: 50 (0.5%) |

**Example prompts:**
- *"Swap 0.1 ETH for USDC on Base"*
- *"Swap 100 USDC for USDT on Polygon"*

---

#### `monei_swap_tokens_solana`
Swaps tokens on Solana. Routes automatically between SOL and SPL tokens.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number\|string | Yes | Amount to swap |
| `inputMint` | string | No | Mint address of token to sell. Omit when selling SOL |
| `outputMint` | string | No | Mint address of token to buy. Omit when buying SOL |
| `slippageBps` | number | No | Slippage tolerance in basis points. Default: 50 (0.5%) |

**Example prompts:**
- *"Swap 1 SOL for USDC"*
- *"Swap 100 USDC for SOL"*

---

### Offramp

#### `monei_get_offramp_quote`
Gets the live exchange rate for selling crypto to NGN.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | Token to sell: `USDT`, `USDC`, or `CNGN` |
| `network` | string | Yes | Network: `base`, `polygon`, `arbitrum-one`, `bnb-smart-chain`, `ethereum`, `optimism` |
| `amount` | number | Yes | Amount of token to sell |
| `fiat` | string | No | Fiat to receive. Default: `NGN` |

**Example prompt:** *"What's the rate for selling 100 USDT on Base today?"*

---

#### `monei_sell_crypto_for_naira`
Sells crypto and settles the proceeds to a Nigerian bank account.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number | Yes | Amount of token to sell |
| `token` | string | Yes | Token to sell: `USDT`, `USDC`, or `CNGN` |
| `network` | string | Yes | Network the token is on |
| `fiatCurrency` | string | No | Default: `NGN` |
| `bankCode` | string | Yes | Destination bank code |
| `accountNumber` | string | Yes | Destination account number |
| `accountName` | string | Yes | Account holder name from `monei_verify_bank_account` |

**Returns:**
```json
{
  "reference": "string",
  "status": "string",
  "amounts": { "crypto": {}, "fiat": {}, "exchangeRate": 0, "totalFee": 0 },
  "onChain": { "depositAddress": "string" }
}
```

> Call `monei_get_offramp_quote` first to show the rate. Call `monei_verify_bank_account` to get the `accountName`. Show both to the user for confirmation before calling this.

**Example prompt:** *"Sell 100 USDT on Base to my GTBank account 0123456789"*

---

#### `monei_track_offramp`
Checks the status of an offramp transaction.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `reference` | string | Yes | Reference from `monei_sell_crypto_for_naira` |

**Statuses:** `initiated` → `awaiting_deposit` → `deposit_received` → `processing` → `fiat_sent` → `completed`

**Example prompt:** *"What's the status of my USDT sale?"*

---

### Bill payments

#### `monei_get_bill_providers`
Lists available billers and packages for a bill category.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `category` | string | Yes | `AIRTIME`, `MOBILEDATA`, `CABLEBILLS`, or `UTILITYBILLS` |
| `billerName` | string | Conditional | Required for non-electricity categories (e.g. `MTN`, `DSTV`) |

**Example prompts:**
- *"What MTN data plans are available?"*
- *"What electricity providers do you support?"*

---

#### `monei_pay_bill`
Pays a bill. Routes to the correct payment method based on `category`.

**Common inputs:** `category` (required), plus category-specific fields:

| Category | Required fields |
|---|---|
| `AIRTIME` | `phoneNumber`, `biller`, `amount` |
| `MOBILEDATA` | `phoneNumber`, `biller`, `itemCode` |
| `UTILITYBILLS` | `meterNumber`, `disco`, `amount` |
| `CABLEBILLS` | `smartcardNumber`, `biller`, `itemCode` |

All categories also accept `isSchedule`, `scheduleData`, `saveBeneficiary`, `beneficiaryName`.

> Always call `monei_get_bill_providers` first to get valid `biller` and `itemCode` values.

**Example prompts:**
- *"Buy ₦1,000 MTN airtime for 08012345678"*
- *"Pay ₦5,000 to my IKEDC meter 12345678901"*
- *"Subscribe DSTV Compact for smartcard 1234567890"*
- *"Pay my DSTV every month on the 1st"*

---

#### `monei_get_bill_history`
Returns recent bill payment history across all categories.

**Inputs:** none

**Example prompt:** *"Show my recent bill payments"*

---

### Transactions

#### `monei_get_transaction_history`
Returns recent wallet transactions.

**Inputs:** none

**Example prompt:** *"Show my recent transactions"*

---

#### `monei_get_transaction`
Gets a single transaction by ID or reference.

**Inputs:**
| Field | Type | Required | Description |
|---|---|---|---|
| `reference` | string | Yes | Transaction ID or reference string |

**Example prompt:** *"What happened with transaction ref_abc123?"*

---

## Common agent patterns

These natural language prompts work well out of the box:

**Check balance and send naira**
> *"Check my balance, then send ₦10,000 to my GTBank account 0123456789. The bank code is 058."*

Agent flow: `get_wallet` → `verify_bank_account` → confirm with user → `send_naira_to_bank`

---

**Full offramp flow**
> *"I want to sell 200 USDT on Polygon to my Access Bank account 0987654321"*

Agent flow: `get_offramp_quote` → `get_banks` → `verify_bank_account` → show rate + account name → confirm → `sell_crypto_for_naira` → `track_offramp`

---

**Buy airtime**
> *"Buy ₦500 Airtel airtime for 08098765432"*

Agent flow: `get_bill_providers` (AIRTIME, Airtel) → `get_wallet` → `pay_bill`

---

**Swap and check**
> *"Swap 0.05 ETH for USDC on Base, then show me my updated portfolio"*

Agent flow: `get_evm_portfolio` → confirm → `swap_tokens_evm` → `get_evm_portfolio`

---

**Peer transfer**
> *"Send ₦2,000 to jane@example.com from my Monei wallet"*

Agent flow: `get_wallet` → confirm balance → `send_naira_to_user`

---

## Troubleshooting

**Tools not showing up in Claude Desktop**
- Check that `MONEI_API_KEY` is set in `claude_desktop_config.json`
- Restart Claude Desktop fully after config changes
- Check stderr logs: `tail -f ~/Library/Logs/Claude/mcp*.log` (macOS)

**`Authentication failed — your API key is invalid or expired`**
- Verify your API key in the Monei dashboard
- Make sure `MONEI_ENV` matches the environment your key belongs to (sandbox vs live)
- In HTTP/SSE mode, check the `Authorization: Bearer` header is being sent

**`Rate limit exceeded — please wait a moment`**
- The server automatically retries up to 3 times with exponential backoff
- If you see this in a tool response, the retries were exhausted — wait 30 seconds and try again

**`Session not found or expired` (SSE mode)**
- The SSE session expired (1 hour TTL) or the server restarted
- Re-open the `/sse` connection your MCP client will reconnect automatically in most cases

**Zod validation errors on tool inputs**
- The agent passed a wrong type (e.g. `"100"` instead of `100` for an amount)
- All amount fields use `z.coerce.number()` so string numbers are accepted
- If you see this, check the exact field name in the error message and fix the agent prompt

---

## Security

- API keys never appear in logs, error messages, or stack traces
- Transaction PINs are request-scoped. never stored, cached, or logged
- Zod validation runs before the SDK is touched. invalid input is rejected immediately

---

## License

MIT