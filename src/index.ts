import { Interface, JsonRpcProvider } from "ethers";
import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// RPC endpoint and starting block for backfill.
const RPC_URL = "https://ethereum-rpc.publicnode.com";
const INIT_BLOCK = 24248600;

// Token and polling parameters.
const TOKEN_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const CONFIRMATIONS = 15;
const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 2;
const MAX_BATCH_SIZE = 30;

// Storage locations (state + event data) and ABI path.
const DATA_DIR = path.resolve("data");
const STATE_PATH = path.join(DATA_DIR, "last_processed_block.json");
const EVENTS_PATH = path.join(DATA_DIR, "transfer_events.jsonl");
const ABI_PATH = path.resolve("abi", "erc20.json");

type State = {
  lastProcessedBlock: number;
};

type TransferEventRecord = {
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  value: string;
};

// Simple async sleep helper for polling.
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Simple logger with timestamp for observability.
const logInfo = (message: string, details?: Record<string, unknown>) => {
  const ts = new Date().toISOString();
  if (details) {
    console.log(`[${ts}] ${message}`, details);
  } else {
    console.log(`[${ts}] ${message}`);
  }
};

// Read the ABI from disk.
const loadAbi = async () => {
  const raw = await readFile(ABI_PATH, "utf-8");
  return JSON.parse(raw);
};

// Ensure data directory and seed files exist.
const ensureStorage = async () => {
  await mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(STATE_PATH)) {
    const initialState: State = { lastProcessedBlock: INIT_BLOCK - 1 };
    await writeFile(STATE_PATH, JSON.stringify(initialState, null, 2));
  }

  if (!existsSync(EVENTS_PATH)) {
    await writeFile(EVENTS_PATH, "");
  }
};

// Read last processed block from disk with a safe fallback.
const loadState = async (): Promise<State> => {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.lastProcessedBlock !== "number") {
      throw new Error("Invalid state shape");
    }
    return parsed;
  } catch {
    return { lastProcessedBlock: INIT_BLOCK - 1 };
  }
};

// Persist last processed block to disk.
const saveState = async (lastProcessedBlock: number) => {
  const state: State = { lastProcessedBlock };
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
};

// Append each event as a JSON line for easy streaming writes.
const appendEvent = async (record: TransferEventRecord) => {
  await appendFile(EVENTS_PATH, `${JSON.stringify(record)}\n`);
};

// Resolve the latest block that is considered confirmed.
const getConfirmedHead = async (provider: JsonRpcProvider) => {
  const latest = await provider.getBlockNumber();
  return Math.max(0, latest - CONFIRMATIONS);
};

// Main polling loop.
const main = async () => {
  await ensureStorage();

  const abi = await loadAbi();
  const iface = new Interface(abi);
  const transferEvent = iface.getEvent("Transfer");
  if (!transferEvent) {
    throw new Error("Transfer event not found in ABI");
  }
  const transferTopic = transferEvent.topicHash;
  const provider = new JsonRpcProvider(RPC_URL);

  // Resume from last processed block to enable recovery.
  let { lastProcessedBlock } = await loadState();
  logInfo("Indexer starting", {
    rpcUrl: RPC_URL,
    token: TOKEN_ADDRESS,
    confirmations: CONFIRMATIONS,
    batchSize: BATCH_SIZE,
    pollIntervalMs: POLL_INTERVAL_MS,
    lastProcessedBlock,
  });

  while (true) {
    try {
      const confirmedHead = await getConfirmedHead(provider);
      logInfo("Polling tick", {
        confirmedHead,
        lastProcessedBlock,
      });

      if (confirmedHead > lastProcessedBlock) {
        // Scale batch size when far behind, shrink when near the head.
        const lag = confirmedHead - lastProcessedBlock;
        const effectiveBatchSize =
          lag > BATCH_SIZE ? Math.min(MAX_BATCH_SIZE, lag) : BATCH_SIZE;

        // Process blocks in batches to balance catch-up speed and RPC load.
        const fromBlock = lastProcessedBlock + 1;
        const toBlock = Math.min(
          lastProcessedBlock + effectiveBatchSize,
          confirmedHead
        );
        logInfo("Fetching logs", {
          fromBlock,
          toBlock,
          effectiveBatchSize,
          lag,
        });

        // Fetch Transfer logs for the confirmed range.
        const logs = await provider.getLogs({
          address: TOKEN_ADDRESS,
          fromBlock,
          toBlock,
          topics: [transferTopic],
        });
        logInfo("Logs fetched", { count: logs.length });

        let processedEvents = 0;
        for (const log of logs) {
          try {
            // Decode and persist each log independently.
            const parsed = iface.parseLog(log);
            if (!parsed) {
              throw new Error("Unable to parse log");
            }

            const record: TransferEventRecord = {
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              txHash: log.transactionHash,
              logIndex: log.index,
              from: parsed.args.from,
              to: parsed.args.to,
              value: parsed.args.value.toString(),
            };

            await appendEvent(record);
            processedEvents += 1;
          } catch (error) {
            // Do not stop processing on per-event failures.
            console.error("Failed to parse or store event", {
              blockNumber: log.blockNumber,
              logIndex: log.index,
              error,
            });
          }
        }

        // Persist progress for recovery.
        lastProcessedBlock = toBlock;
        await saveState(lastProcessedBlock);
        logInfo("Batch stored", {
          fromBlock,
          toBlock,
          processedEvents,
        });
      } else {
        logInfo("No confirmed blocks to process; waiting", {
          nextPollMs: POLL_INTERVAL_MS,
        });
      }
    } catch (error) {
      // Keep polling even if a full cycle fails.
      console.error("Polling cycle failed", error);
    }

    // Wait before the next poll to control RPC load.
    await delay(POLL_INTERVAL_MS);
  }
};

main().catch((error) => {
  console.error("Fatal error", error);
  process.exitCode = 1;
});
