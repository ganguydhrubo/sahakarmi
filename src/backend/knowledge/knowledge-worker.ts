import { runKnowledgeWorker, type WorkerPort } from "./knowledge-worker-core";

/**
 * Entry point of the Knowledge Bases utility process (Electron `utilityProcess.fork`). Built to
 * out/main/knowledge-worker.js next to the main bundle.
 */
const port = (process as unknown as { parentPort?: WorkerPort }).parentPort;
if (port) {
  runKnowledgeWorker(port, (code) => process.exit(code));
} else {
  console.error("knowledge-worker must run as an Electron utility process");
  process.exit(1);
}
