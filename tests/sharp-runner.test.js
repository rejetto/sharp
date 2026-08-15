const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')

const source = fs.readFileSync(`${__dirname}/../dist/sharp-runner.js`, 'utf8')
const workerSource = fs.readFileSync(`${__dirname}/../dist/sharp-worker.js`, 'utf8')

test('timeout kills its worker and an old exit cannot reject new jobs', async () => {
    const children = []
    class FakeChild extends EventEmitter {
        connected = true
        send() {}
        disconnect() { this.connected = false }
        kill() { this.killed = true; this.connected = false }
    }
    const context = {
        Buffer,
        __dirname: `${__dirname}/../dist`,
        clearTimeout,
        module: { exports: {} },
        require: id => id === 'child_process'
            ? { fork: () => children[children.push(new FakeChild()) - 1] }
            : require(id),
        setTimeout,
        Uint8Array,
    }
    vm.runInNewContext(`${source}\nmodule.exports.SharpProcessRunner = SharpProcessRunner`, context)
    const runner = new context.module.exports.SharpProcessRunner()

    await assert.rejects(runner.run(Buffer.from('first'), [], { timeout: 5 }), /timed out/)
    assert.equal(children[0].killed, true)

    const second = runner.run(Buffer.from('second'))
    children[0].emit('exit', 0, null)
    children[1].emit('message', { type: 'result', jobId: '2', payload: Buffer.from('ok') })
    assert.equal((await second).toString(), 'ok')
})

test('worker reconstructs buffers serialized over IPC', async () => {
    let input
    let onMessage
    const context = {
        Buffer,
        process: {
            on: (_, callback) => { onMessage = callback },
            send() {},
        },
        require: () => value => {
            input = value
            return { toBuffer: async () => Buffer.from('ok') }
        },
    }
    vm.runInNewContext(workerSource, context)
    const serialized = JSON.parse(JSON.stringify(Buffer.from('image')))
    await onMessage({ type: 'job', jobId: '1', input: serialized })

    assert.equal(Buffer.isBuffer(input), true)
    assert.equal(input.toString(), 'image')
})
