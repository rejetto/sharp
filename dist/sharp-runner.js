"use strict";

const { fork } = require("child_process");
const path = require("path");

const workerPath = path.join(__dirname, "sharp-worker.js");

/**
 * Convert a user-friendly operation description into a normalized object
 * understood by the worker process.
 * @param {any} operation
 * @param {number} index
 * @returns {{method: string, args: any[]}}
 */
function normalizeOperation(operation, index) {
    if (operation == null) {
        throw new TypeError(`Operation at index ${index} must not be null or undefined`);
    }

    if (Array.isArray(operation)) {
        const [method, ...args] = operation;
        if (typeof method !== "string" || method.length === 0) {
            throw new TypeError(`Operation at index ${index} must declare a method name`);
        }
        return { method, args };
    }

    if (typeof operation === "object") {
        const method = String(
            operation.method ?? operation.name ?? operation.action ?? ""
        ).trim();
        if (method.length === 0) {
            throw new TypeError(`Operation at index ${index} must declare a method name`);
        }
        const args = Array.isArray(operation.args) ? operation.args : [];
        return { method, args };
    }

    throw new TypeError(`Operation at index ${index} must be an array or an object`);
}

class SharpProcessRunner {
    constructor() {
        this.child = null;
        this.pending = new Map();
        this.nextId = 1;
    }

    /**
     * Ensure a worker process exists and is ready to receive jobs.
     */
    ensureChild() {
        if (this.child && this.child.connected) {
            return;
        }

        const child = this.child = fork(workerPath, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
        child.on("message", (message) => {
            if (this.child === child) {
                this.handleMessage(message);
            }
        });
        child.on("exit", (code, signal) => {
            if (this.child !== child) {
                return;
            }
            const error = new Error(
                `Sharp worker exited unexpectedly${code != null ? ` (code ${code})` : ""}${
                    signal ? ` (signal ${signal})` : ""
                }`
            );
            this.child = null;
            this.rejectPending(error);
        });
    }

    /**
     * Submit a job to the worker.
     * @param {Buffer | Uint8Array | string} input
     * @param {Array} operations
     * @param {{ sharpOptions?: object, timeout?: number }} [options]
     * @returns {Promise<Buffer>}
     */
    run(input, operations = [], options = {}) {
        if (
            !Buffer.isBuffer(input) &&
            !(input instanceof Uint8Array) &&
            typeof input !== "string"
        ) {
            throw new TypeError("Input must be a Buffer, Uint8Array, or file path string");
        }

        if (!Array.isArray(operations)) {
            throw new TypeError("Operations must be an array");
        }

        this.ensureChild();
        const child = this.child;
        const jobId = String(this.nextId++);
        const normalizedOperations = operations.map((operation, index) =>
            normalizeOperation(operation, index)
        );

        let timeoutHandle = null;

        const promise = new Promise((resolve, reject) => {
            if (!this.child) {
                reject(new Error("Sharp worker is not available"));
                return;
            }

            if (options.timeout != null) {
                const timeoutMs = Number(options.timeout);
                if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                    reject(new Error("Timeout must be a positive number"));
                    return;
                }
                timeoutHandle = setTimeout(() => {
                    // libvips work cannot be reliably cancelled in-process, so terminate its isolated worker
                    this.terminateChild(child, new Error(`Sharp job ${jobId} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }

            this.pending.set(jobId, { resolve, reject, timeout: timeoutHandle });

            const messageInput =
                typeof input === "string"
                    ? input
                    : Buffer.isBuffer(input)
                    ? input
                    : Buffer.from(input);

            const payload = {
                type: "job",
                jobId,
                input: messageInput,
                operations: normalizedOperations,
                sharpOptions: options.sharpOptions,
            };

            try {
                child.send(payload);
            } catch (error) {
                this.pending.delete(jobId);
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                reject(error);
            }
        });

        return promise;
    }

    /**
     * Handle a message coming back from the worker process.
     * @param {any} message
     */
    handleMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }

        const { jobId } = message;
        if (!jobId || !this.pending.has(jobId)) {
            return;
        }

        const { resolve, reject, timeout } = this.pending.get(jobId);
        this.pending.delete(jobId);
        if (timeout) {
            clearTimeout(timeout);
        }

        if (message.type === "result") {
            resolve(Buffer.from(message.payload));
            return;
        }

        if (message.type === "error") {
            const error = new Error(message.error?.message ?? "Sharp worker error");
            if (message.error?.stack) {
                error.stack = message.error.stack;
            }
            reject(error);
        }
    }

    rejectPending(error) {
        for (const { reject, timeout } of this.pending.values()) {
            if (timeout) {
                clearTimeout(timeout);
            }
            reject(error);
        }
        this.pending.clear();
    }

    terminateChild(child, error) {
        if (this.child !== child) {
            return;
        }
        this.child = null;
        this.rejectPending(error);
        child.kill();
    }

    /**
     * Dispose of the worker process and reject any pending jobs.
     */
    dispose() {
        if (!this.child) {
            return;
        }

        const child = this.child;
        this.child = null;
        this.rejectPending(new Error("Sharp worker disposed while job was pending"));
        child.send({ type: "shutdown" });
        child.disconnect();
    }
}

const runner = new SharpProcessRunner();

async function runSharpCommands(input, operations, options) {
    return runner.run(input, operations, options);
}

function disposeSharpWorker() {
    runner.dispose();
}

module.exports = {
    runSharpCommands,
    disposeSharpWorker,
};
