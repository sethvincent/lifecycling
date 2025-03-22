import test from 'brittle'
import * as fs from 'fs/promises'
import http from 'http'
import Lifecycle, { Queue, StateMachine } from '../src/index.js'

test('basic open/close flow works', async (t) => {
    let opened = false
    let closed = false

    const lifecycle = new Lifecycle({
        async open () {
            opened = true
        },
        async close () {
            closed = true
        },
    })

    t.is(lifecycle.state, 'init')

    await lifecycle.open()
    t.is(lifecycle.state, 'opened')
    t.ok(opened)

    await lifecycle.close()
    t.is(lifecycle.state, 'closed')
    t.ok(closed)
})

test('errors during transitions prevent state change', async (t) => {
    let openAttempts = 0

    const lifecycle = new Lifecycle({
        async open () {
            openAttempts++
            throw new Error('open failed')
        },
    })

    t.is(lifecycle.state, 'init', 'initial state is init')

    try {
        await lifecycle.open()
        t.fail('should have thrown')
    } catch (error) {
        t.is(error.message, 'open failed')
        t.is(openAttempts, 1, 'opener was called once')
        t.is(lifecycle.state, 'opening', 'state never moved to opened')
    }

    lifecycle.reset()

    try {
        await lifecycle.open()
        t.fail('should have thrown')
    } catch (error) {
        t.is(error.message, 'open failed')
        t.is(openAttempts, 2, 'opener called again after error')
        t.is(lifecycle.state, 'opening', 'state still opening after second error')
    }
})

test('deduplicates concurrent opens', async (t) => {
    let openCount = 0

    const lifecycle = new Lifecycle({
        async open () {
            openCount++
        },
        async close () {},
    })

    await Promise.all([
        lifecycle.open(),
        lifecycle.open(),
    ])

    t.is(openCount, 1, 'opener only called once')
})

test('full lifecycle with suspend/resume', async (t) => {
    let openCount = 0
    let suspendCount = 0
    let resumeCount = 0
    let closeCount = 0

    const lifecycle = new Lifecycle({
        async open () {
            openCount++
        },
        async suspend () {
            suspendCount++
        },
        async resume () {
            resumeCount++
        },
        async close () {
            closeCount++
        },
    })

    t.is(lifecycle.state, 'init')

    await lifecycle.open()
    t.is(lifecycle.state, 'opened')
    t.is(openCount, 1)

    await lifecycle.suspend()
    t.is(lifecycle.state, 'suspended')
    t.is(suspendCount, 1)

    await lifecycle.resume()
    t.is(lifecycle.state, 'resumed')
    t.is(resumeCount, 1)

    await lifecycle.close()
    t.is(lifecycle.state, 'closed')
    t.is(closeCount, 1)
})

test('cannot suspend before opening', async (t) => {
    const lifecycle = new Lifecycle({ open () {}, close () {} })
    await lifecycle.suspend()
    t.is(lifecycle.state, 'init', 'stays in init state')
})

test('cannot resume before suspending', async (t) => {
    const lifecycle = new Lifecycle({ open () {}, close () {} })
    await lifecycle.open()
    await lifecycle.resume()
    t.is(lifecycle.state, 'opened', 'stays in opened state')
})

test('handles concurrent state changes', async (t) => {
    const lifecycle = new Lifecycle({ open () {}, close () {} })

    const transitions = []
    lifecycle.on((transition) => {
        transitions.push(transition)
    })

    await lifecycle.open()

    const suspend = lifecycle.suspend()
    const close = lifecycle.close()

    await Promise.all([suspend, close])
    t.alike(['opening', 'opened', 'suspending', 'suspended', 'closing', 'closed'], transitions)
})

test('handles racing state transitions', async (t) => {
    let states = []

    const lifecycle = new Lifecycle({
        async open () {
            states.push('opening')
            await new Promise((r) => setTimeout(r, 10))
            states.push('opened')
        },
        async close () {
            states.push('closing')
            await new Promise((r) => setTimeout(r, 5))
            states.push('closed')
        },
    })

    const open = lifecycle.open()
    const close = lifecycle.close()

    await Promise.all([open, close])

    t.alike(states, ['opening', 'opened', 'closing', 'closed'])
    t.is(lifecycle.state, 'closed')
})

test('can close from suspended state', async (t) => {
    const lifecycle = new Lifecycle({ open () {}, close () {} })

    await lifecycle.open()
    await lifecycle.suspend()
    t.is(lifecycle.state, 'suspended')

    await lifecycle.close()
    t.is(lifecycle.state, 'closed')
})

test('can close while suspending', async (t) => {
    const lifecycle = new Lifecycle({
        open () {},
        close () {},
        async suspend () {
            await new Promise((resolve) => {
                setTimeout(resolve, 100)
            })
        },
    })

    await lifecycle.open()
    lifecycle.suspend()
    t.is(lifecycle.state, 'suspending')

    await lifecycle.close()
    t.is(lifecycle.state, 'closed')
})

test('can wait for specific state', async (t) => {
    const lifecycle = new Lifecycle({
        async open () {},
        async closed () {},
    })

    lifecycle.open()
    t.is(lifecycle.state, 'opening')
    await lifecycle.until('opened')
    t.is(lifecycle.state, 'opened')
})

test('handles transition sequences', async (t) => {
    const delays = {
        open: 20,
        suspend: 15,
        resume: 10,
        close: 5,
    }

    const lifecycle = new Lifecycle({
        async open () {
            await new Promise((r) => setTimeout(r, delays.open))
        },
        async suspend () {
            await new Promise((r) => setTimeout(r, delays.suspend))
        },
        async resume () {
            await new Promise((r) => setTimeout(r, delays.resume))
        },
        async close () {
            await new Promise((r) => setTimeout(r, delays.close))
        },
    })

    let transitions = []
    lifecycle.on((transition) => {
        transitions.push(transition)
    })

    await lifecycle.open()
    await lifecycle.until('opened')

    const suspend = lifecycle.suspend()
    await lifecycle.until('suspended')

    await lifecycle.close()
    await suspend

    t.alike(transitions, [
        'opening',
        'opened',
        'suspending',
        'suspended',
        'closing',
        'closed',
    ])
    t.is(lifecycle.state, 'closed')
})

test('wait handles complex transition sequences', async (t) => {
    const delays = {
        open: 20,
        suspend: 15,
        resume: 10,
        close: 5,
    }

    const lifecycle = new Lifecycle({
        async open () {
            console.log('open called')
            await new Promise((r) => setTimeout(r, delays.open))
            console.log('open completed')
        },
        async suspend () {
            console.log('suspend called')
            await new Promise((r) => setTimeout(r, delays.suspend))
            console.log('suspend completed')
        },
        async resume () {
            console.log('resume called')
            await new Promise((r) => setTimeout(r, delays.resume))
            console.log('resume completed')
        },
        async close () {
            console.log('close called')
            await new Promise((r) => setTimeout(r, delays.close))
            console.log('close completed')
        },
    })

    let transitions = []
    lifecycle.on((transition) => {
        transitions.push(transition)
    })

    // Start multiple operations and waits concurrently
    const tasks = [
        lifecycle.open(),
        lifecycle.until('opened'),
        lifecycle.suspend(),
        lifecycle.until('suspended'),

        (async () => {
            await lifecycle.resume()
        })(),
        (async () => {
            await lifecycle.close()
        })(),
    ]

    await Promise.all(tasks)

    t.alike(transitions, [
        'opening',
        'opened',
        'suspending',
        'suspended',
        'resuming',
        'resumed',
        'closing',
        'closed',
    ])
    t.is(lifecycle.state, 'closed')
})

test('suspend queues after opening', async (t) => {
    const lifecycle = new Lifecycle({
        async open () {},
        async suspend () {},
    })

    // Start opening
    lifecycle.open()
    t.is(lifecycle.state, 'opening')

    // Queue suspend
    lifecycle.suspend()

    // State should still be opening until open completes
    t.is(lifecycle.state, 'opening', 'still opening')

    // Wait for open to complete
    await lifecycle.until('opened')

    // After open completes, suspend should start
    t.is(lifecycle.state, 'suspending', 'now suspending')

    // Wait for suspend to complete
    await lifecycle.until('suspended')
    t.is(lifecycle.state, 'suspended', 'completed both operations')
})

test('cannot suspend while closing', async (t) => {
    const lifecycle = new Lifecycle({
        async open () {},
        async close () {},
        async suspend () {},
    })

    const transitions = []
    lifecycle.on((transition) => {
        transitions.push(transition)
    })

    await lifecycle.open()

    lifecycle.close()
    t.is(lifecycle.state, 'closing')

    await lifecycle.until('closed')

    t.is(lifecycle.state, 'closed')

    t.alike(transitions, [
        'opening',
        'opened',
        'closing',
        'closed',
    ])
})

test('manages file handle lifecycle', async (t) => {
    const path = '/tmp/lifecycle-test.txt'
    let handle = null

    const lifecycle = new Lifecycle({
        async open () {
            handle = await fs.open(path, 'w+')
        },
        async suspend () {
            await handle.sync()
            await handle.close()
            handle = null
        },
        async resume () {
            handle = await fs.open(path, 'r+')
        },
        async close () {
            await handle.close()
            handle = null
        },
    })

    await lifecycle.open()
    t.ok(handle, 'file handle opened')

    await handle.write('hello')

    await lifecycle.suspend()

    t.is(handle, null, 'handle closed during suspend')

    await lifecycle.resume()
    const data = await handle.readFile('utf8')
    t.is(data, 'hello', 'data persisted through suspend/resume')

    await lifecycle.close()
    t.is(handle, null, 'handle cleaned up')
})

test('http server suspend/resume', async (t) => {
    class Server {
        #lifecycle = new Lifecycle({
            open: this.#open.bind(this),
            suspend: this.#suspend.bind(this),
            resume: this.#resume.bind(this),
            close: this.#close.bind(this),
        })

        async #open () {
            this.server = http.createServer()
            await new Promise((resolve) => this.server.listen(0, resolve))
        }

        async #suspend () {
            this.server.close()
            await new Promise((resolve, reject) => {
                this.server.on('close', resolve)
                this.server.on('error', reject)
            })
        }

        async #resume () {
            await new Promise((resolve) => this.server.listen(0, resolve))
        }

        async #close () {
            this.server.close()
            await new Promise((resolve, reject) => {
                this.server.on('close', resolve)
                this.server.on('error', reject)
            })
            this.server = null
        }

        async start () {
            await this.#lifecycle.open()
        }

        async suspend () {
            await this.#lifecycle.suspend()
        }

        async resume () {
            await this.#lifecycle.resume()
        }

        async stop () {
            await this.#lifecycle.close()
        }

        get state () {
            return this.#lifecycle.state
        }
    }

    const server = new Server()
    t.is(server.state, 'init')

    await server.start()
    t.is(server.state, 'opened')

    await server.suspend()
    t.is(server.state, 'suspended')

    await server.resume()
    t.is(server.state, 'resumed')

    await server.stop()
    t.is(server.state, 'closed')
})

test('Queue processes items in order', async (t) => {
    const results = []
    const queue = new Queue(async (item) => {
        results.push(item)
    })

    await Promise.all([
        queue.enqueue(1),
        queue.enqueue(2),
        queue.enqueue(3),
    ])

    t.alike(results, [1, 2, 3], 'items processed in order')
})

test('Queue handles errors properly', async (t) => {
    const queue = new Queue(async (item) => {
        if (item === 'error') throw new Error('test error')
        return item
    })

    await queue.enqueue('success')

    try {
        await queue.enqueue('error')
        t.fail('should have thrown')
    } catch (error) {
        t.is(error.message, 'test error', 'error propagated')
    }

    // Queue should continue processing after error
    const result = await queue.enqueue('continue')
    t.is(result, undefined, 'processing continues after error')
})

test('Queue processes items sequentially', async (t) => {
    const processingOrder = []
    const completionOrder = []

    const queue = new Queue(async (item) => {
        processingOrder.push(item)
        await new Promise((r) => setTimeout(r, 50 - (item * 15)))
        completionOrder.push(item)
    })

    await Promise.all([
        queue.enqueue(1),
        queue.enqueue(2),
        queue.enqueue(3),
    ])

    t.alike(processingOrder, [1, 2, 3], 'processing started in order')
    t.alike(completionOrder, [1, 2, 3], 'processing completed in order')
})

test('StateMachine handles invalid transitions', async (t) => {
    const transitions = {
        init: ['started'],
        started: ['stopped'],
        stopped: [],
    }

    const machine = new StateMachine(transitions)

    t.is(machine.state, 'init')
    t.ok(machine.allows('started'), 'allows valid transition')
    t.is(machine.allows('stopped'), false, 'disallows invalid transition')

    try {
        machine.transition('stopped')
        t.fail('should have thrown')
    } catch (error) {
        t.ok(error.message.includes('Invalid transition'), 'throws on invalid transition')
    }
})

test('StateMachine waits for state changes', async (t) => {
    const transitions = {
        init: ['processing', 'error'],
        processing: ['complete', 'error'],
        error: ['init'],
        complete: [],
    }

    const machine = new StateMachine(transitions)

    t.is(machine.state, 'init')

    // Set up two concurrent waiters
    const waiter1 = machine.until('complete')
    const waiter2 = machine.until('error')

    // Transition to processing
    machine.transition('processing')
    t.is(machine.state, 'processing')

    // Resolve to error state
    machine.transition('error')

    // The error waiter should resolve
    await waiter2
    t.is(machine.state, 'error')

    // Complete waiter should still be pending
    const pending = Promise.race([
        waiter1.then(() => 'resolved'),
        new Promise((r) => setTimeout(() => r('timeout'), 50)),
    ])
    t.is(await pending, 'timeout', 'complete waiter still pending')

    // Transition to init then complete
    machine.transition('init')
    machine.transition('processing')
    machine.transition('complete')

    // Now complete waiter should resolve
    await waiter1
    t.is(machine.state, 'complete')
})

test('StateMachine resolves immediately for current state', async (t) => {
    const transitions = {
        init: ['started'],
        started: ['stopped'],
    }

    const machine = new StateMachine(transitions)
    t.is(machine.state, 'init')

    // Should resolve immediately since we're already in init state
    await machine.until('init')
    t.pass('resolved immediately for current state')
})
