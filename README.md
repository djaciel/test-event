# ERC-20 Transfer Indexer (Polling + Sharded Processing)

This project indexes ERC-20 `Transfer` events using a polling strategy with confirmation depth, durable state, and optional sharding across multiple instances. The goal is to be resilient, recoverable, and safe to run in parallel while keeping the storage simple (JSONL).

## Philosophy

- **Recoverability first**: the last processed block is persisted to disk so the process can restart without losing progress.
- **Confirmed data only**: we only ingest blocks that are at least `CONFIRMATIONS` deep to reduce reorg risk.
- **Backfill speed with safety**: the batch size grows when far behind and shrinks as we approach the confirmed head.
- **Parallelism without duplication**: multiple instances can process the same blocks by sharding logs deterministically with `logIndex`.
- **Simplicity over complexity**: a JSONL file is used for events to keep the storage layer minimal and transparent.

## How It Works

1. The poller checks the latest block number and subtracts a confirmation depth.
2. It processes blocks in small batches until it catches up to the confirmed head.
3. Each event is parsed and stored as a JSON line with a unique identifier and `instanceId`.
4. The last processed block is stored per instance in `data/last_processed_block.json`.
5. When multiple instances run, each uses a shard index to decide which logs to persist.

## Project Structure

- `src/index.ts`: polling loop, persistence, and sharding logic
- `abi/erc20.json`: minimal ABI with the `Transfer` event
- `data/transfer_events.jsonl`: JSONL output (one event per line)
- `data/last_processed_block.json`: per-instance progress state
- `instructions.md`: original test instructions

## Commands

Install dependencies:

```
pnpm install
```

Run a single instance:

```
pnpm start
```

Run two instances (sharded):

```
pnpm run start:instance0
pnpm run start:instance1
```

Build TypeScript:

```
pnpm run build
```

## Configuration

You can control the behavior with environment variables:

- `SHARD_COUNT`: total number of instances (default: `1`)
- `SHARD_INDEX`: index of this instance (default: `0`)
- `INSTANCE_ID`: identifier written into each event and state (default: `shard-{index}`)

Core tuning parameters are defined at the top of `src/index.ts`:

- `RPC_URL`
- `INIT_BLOCK`
- `CONFIRMATIONS`
- `POLL_INTERVAL_MS`
- `BATCH_SIZE`
- `MAX_BATCH_SIZE`

## Event Format

Each line in `data/transfer_events.jsonl` looks like this:

```
{"blockNumber":24248600,"blockHash":"0x...","txHash":"0x...","logIndex":0,"from":"0x...","to":"0x...","value":"123","instanceId":"instance-0"}
```

## Notes on Concurrency

- **State file**: writes are guarded with a simple lock (`data/state.lock`) to avoid corrupting `last_processed_block.json`.
- **Events file**: multiple processes append concurrently. This is usually safe for line-oriented append workloads on Unix-like systems, but a database is more robust if you need strong guarantees.

If needed, you can switch to a DB (SQLite/Postgres) and enforce a unique constraint on `(txHash, logIndex)` to guarantee deduplication.
