"use strict";

const sharp = require("sharp");

/**
 * Apply a sequence of operations to an existing sharp pipeline.
 * @param {import("sharp")} pipeline
 * @param {Array<{method: string, args: any[]}>} operations
 */
function applyOperations(pipeline, operations) {
    if (!Array.isArray(operations)) {
        throw new TypeError("Operations must be an array");
    }

    for (let index = 0; index < operations.length; index += 1) {
        const step = operations[index];
        if (!step || typeof step !== "object") {
            throw new TypeError(`Operation at index ${index} must be an object`);
        }

        const { method, args } = step;
        if (typeof method !== "string" || method.length === 0) {
            throw new TypeError(`Operation at index ${index} is missing method`);
        }
        if (method === "toBuffer" || method === "toFile" || method === "pipe") {
            throw new Error(`Method "${method}" is not allowed in remote sharp operations`);
        }

        const params = Array.isArray(args) ? args : [];
        if (typeof pipeline[method] !== "function") {
            throw new Error(`Sharp does not expose method "${method}"`);
        }
        pipeline = pipeline[method](...params);
    }

    return pipeline;
}

process.on("message", async (message) => {
    if (!message || typeof message !== "object") {
        return;
    }

    const { type } = message;
    if (type === "job") {
        const { jobId, input, operations = [], sharpOptions } = message;
        try {
            let pipeline = sharp(typeof input === "string" ? input : Buffer.from(input), sharpOptions);
            pipeline = applyOperations(pipeline, operations);
            const output = await pipeline.toBuffer();
            process.send?.({ type: "result", jobId, payload: output });
        } catch (error) {
            process.send?.({
                type: "error",
                jobId,
                error: {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
            });
        }
        return;
    }

    if (type === "shutdown") {
        process.exit(0);
    }
});
