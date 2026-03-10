# Changelog

## 1.0.0 2026-03-10

Initial public release of `@mrmonei/mcp-server`.

### What's included

**22 tools across 8 categories:**

Account & Wallet
- `monei_get_account` — fetch the authenticated user's profile
- `monei_get_wallet` — get NGN balance and all subwallets
- `monei_get_evm_portfolio` — full EVM token breakdown with USD values
- `monei_get_solana_portfolio` — SOL and SPL token portfolio
- `monei_get_my_solana_address` — retrieve the user's Solana wallet address
- `monei_get_supported_networks` — list all supported EVM chains with chain IDs

Deposits
- `monei_generate_deposit_link` — generate a NGN deposit payment link
- `monei_check_deposit_status` — check deposit status by reference

NGN Payouts
- `monei_send_naira_to_bank` — send NGN to any Nigerian bank account
- `monei_send_naira_to_user` — peer transfer to another Monei user by email or phone

Banking Utilities
- `monei_get_banks` — list all supported Nigerian banks with codes
- `monei_verify_bank_account` — verify account number and get account holder name

Crypto Sends
- `monei_send_crypto_evm` — send native tokens or ERC-20s on any supported EVM chain
- `monei_send_crypto_solana` — send SOL or SPL tokens on Solana

Token Swaps
- `monei_swap_tokens_evm` — swap tokens on EVM with automatic native/ERC-20 routing
- `monei_swap_tokens_solana` — swap tokens on Solana with automatic SOL/SPL routing

Offramp
- `monei_get_offramp_quote` — get live exchange rate for selling crypto to NGN
- `monei_sell_crypto_for_naira` — sell crypto and settle to a Nigerian bank account
- `monei_track_offramp` — track offramp transaction status by reference

Bill Payments
- `monei_get_bill_providers` — list available billers and packages by category
- `monei_pay_bill` — pay airtime, data, electricity, or cable TV
- `monei_get_bill_history` — retrieve recent bill payment history

Transaction History
- `monei_get_transaction_history` — list recent wallet transactions
- `monei_get_transaction` — get a single transaction by ID or reference

**Three transport modes:**
- `stdio` — for Claude Desktop and local Cursor (default)
- `http` — Streamable HTTP for remote agents and API integrations
- `sse` — Server-Sent Events for Cursor remote and Claude.ai

**Infrastructure:**
- Multi-stage Dockerfile with non-root user
- Railway deployment guide
- Exponential backoff retry on rate limits and 5xx errors (max 3 retries)
- Configurable request timeout via `MONEI_TIMEOUT` env var (default 30s)
- Typed MCP errors with informative messages for every SDK error case
- GitHub Actions CI on every PR (lint, typecheck, tests)