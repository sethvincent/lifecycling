/**
 * A sequential operation queue that ensures operations are processed one at a time
 * in the order they are added.
 *
 * This queue is used internally by the Lifecycle manager to ensure that
 * lifecycle operations (open, close, suspend, resume) execute in sequence
 * without race conditions.
 *
 * The queue handles backpressure automatically - when operations are added
 * faster than they can be processed, they are queued and executed in order
 * when previous operations complete.
 *
 * @private This class is used internally and not intended for direct use.
 */
export class Queue {
    /** @type {Array<{item: Object, resolve: Function, reject: Function}>} */
    #items = []
    /** @type {boolean} */
    #processing = false
    /** @type {(item: {[key: string]: any}) => Promise<void>} */
    #processor

    /**
     * Creates a new operation queue.
     *
     * @param {(item: {[key: string]: any}) => Promise<void>} processor - A function that processes each queued item. Must be async or return a Promise.
     * The processor receives an object with properties that depend on the usage context.
     * In Lifecycle usage, this receives an object with {operation, interimState, toState} properties.
     */
    constructor (processor) {
        this.#processor = processor
    }

    /**
     * Adds an operation to the processing queue.
     *
     * Operations are guaranteed to be processed in the order they are added.
     * The returned promise resolves when the operation completes or rejects
     * if the operation fails.
     *
     * @param {Object} item - The operation data to be processed
     * @returns {Promise<void>} A promise that resolves when the operation completes
     */
    async enqueue (item) {
        const { promise, resolve, reject } = Promise.withResolvers()

        this.#items.push({
            item,
            resolve,
            reject,
        })

        if (!this.#processing) {
            this.#processQueue()
        }

        return promise
    }

    /**
     * Processes the queue of operations in sequence.
     *
     * This private method handles the actual execution of queued operations.
     * It ensures only one operation runs at a time and properly resolves
     * or rejects each operation's promise based on the result.
     *
     * If processing is already in progress or the queue is empty, the method
     * returns immediately.
     *
     * @returns {Promise<void>} A promise that resolves when queue processing completes
     */
    async #processQueue () {
        if (this.#processing || this.#items.length === 0) {
            return
        }

        this.#processing = true

        try {
            while (this.#items.length > 0) {
                const { item, resolve, reject } = this.#items[0]

                try {
                    await this.#processor(item)
                    resolve()
                } catch (error) {
                    reject(error)
                }

                this.#items.shift()
            }
        } finally {
            this.#processing = false
        }
    }
}

/**
 * Manages a state machine with controlled transitions and wait conditions.
 * This class enforces valid state transitions according to a predefined transition map
 * and provides utilities for waiting for specific states to be reached.
 */
export class StateMachine {
    /** @type {string} The current state of the machine */
    #current = 'init'
    /** @type {Object<string, string[]>} Map of state names to allowed destination states */
    #transitions
    /** @type {Object<string, Promise<void>>} Promises that resolve when specific states are reached */
    #transitionPromises = {}
    /** @type {Object<string, Function>} Resolvers for the transition promises */
    #transitionResolvers = {}

    /**
     * Creates a new state machine with the specified transition rules.
     * @param {{ [x: string]: string[]; }} transitions - A map of states to arrays of allowed next states.
     * For example: `{ 'init': ['starting'], 'starting': ['started'] }`
     */
    constructor (transitions) {
        this.#transitions = transitions
    }

    /**
     * The current state of the state machine.
     * @returns {string} The current state identifier.
     */
    get state () {
        return this.#current
    }

    /**
     * Checks if a transition to the specified state is allowed from the current state.
     * @param {string} toState - The target state to check.
     * @returns {boolean} True if the transition is allowed, false otherwise.
     */
    allows (toState) {
        const allowed = this.#transitions[this.#current] || []
        const sure = allowed.includes(toState)
        return sure
    }

    /**
     * Returns a promise that resolves when the specified state is reached.
     * This is useful for coordinating actions that depend on specific states.
     * @param {string} queryState - The state to wait for.
     * @returns {Promise<void>} A promise that resolves when the target state is reached.
     */
    until (queryState) {
        if (this.#current === queryState) {
            return Promise.resolve()
        }

        if (!this.#transitionPromises[queryState]) {
            this.#transitionPromises[queryState] = new Promise((resolve) => {
                this.#transitionResolvers[queryState] = resolve
            })
        }

        return this.#transitionPromises[queryState]
    }

    /**
     * Transitions the state machine to a new state if allowed.
     * @param {string} toState - The target state to transition to.
     * @throws {Error} If the transition is not allowed from the current state.
     */
    transition (toState) {
        if (!this.allows(toState)) {
            throw new Error(`Invalid transition from ${this.#current} to ${toState}`)
        }

        this.#current = toState

        if (this.#transitionResolvers[toState]) {
            this.#transitionResolvers[toState]()
            delete this.#transitionResolvers[toState]
            delete this.#transitionPromises[toState]
        }
    }
}

/**
 * Manages asynchronous lifecycles for resources like databases, network connections,
 * or any system requiring controlled startup/shutdown sequences.
 * @class
 */
export default class Lifecycle {
    /** @type {StateMachine} The state machine that manages transitions */
    #stateMachine
    /** @type {Object<string, Function>} Map of lifecycle operations functions */
    #operations
    /** @type {Object<string, string[]>} Map of state names to allowed destination states */
    #transitions
    /** @type {Queue} Queue that ensures operations run in sequence */
    #queue
    /** @type {Function} Callback for state transitions */
    #onTransition = noop

    /**
     * Creates a new resource lifecycle manager.
     * @param {Object} operations - Lifecycle handler functions
     * @param {Function} [operations.open] - Resource startup logic
     * @param {Function} [operations.close] - Resource shutdown logic
     * @param {Function} [operations.suspend] - Temporary deactivation logic
     * @param {Function} [operations.resume] - Restoration from suspended state
     */
    constructor (operations) {
        this.#operations = {
            open: operations.open || noop,
            close: operations.close || noop,
            suspend: operations.suspend || noop,
            resume: operations.resume || noop,
        }

        this.#transitions = Object.freeze({
            init: ['opening'],
            opening: ['opened'],
            opened: ['suspending', 'closing'],
            suspending: ['suspended', 'closing'],
            suspended: ['resuming', 'closing'],
            resuming: ['resumed'],
            resumed: ['suspending', 'closing'],
            closing: ['closed'],
            closed: [],
        })

        this.#stateMachine = new StateMachine(this.#transitions)
        this.#queue = new Queue((item) => {
            return this.#run(item.operation, item.interimState, item.toState)
        })
    }

    /**
     * The current state of the resource lifecycle.
     * @type {string} One of: init, opening, opened, suspending, suspended, resuming, closing, closed
     */
    get state () {
        return this.#stateMachine.state
    }

    /**
     * Executes a specific operation with custom transition states.
     * @param {string} operator - The operation name to execute (open, close, suspend, resume)
     * @param {string} interimState - The intermediate state during operation
     * @param {string} toState - The final state after successful completion
     * @returns {Promise<void>} Resolves when the operation completes
     * @throws {Error} If the operator name doesn't exist
     */
    async transition (operator, interimState, toState) {
        if (!this.#operations[operator]) {
            throw new Error(`Unknown operator name: ${operator}`)
        }

        return this.#enqueue(this.#operations[operator], interimState, toState)
    }

    /**
     * Starts the resource initialization process.
     * Transitions from 'init' through 'opening' to 'opened'.
     * Operations are queued and processed in order.
     * @returns {Promise<void>} Resolves when opened
     */
    async open () {
        return this.#enqueue(this.#operations.open, 'opening', 'opened')
    }

    /**
     * Initiates permanent resource shutdown.
     * Transitions through 'closing' to 'closed'.
     * Safe to call from most states.
     * @returns {Promise<void>} Resolves when closed
     */
    async close () {
        return this.#enqueue(this.#operations.close, 'closing', 'closed')
    }

    /**
     * Starts temporary resource deactivation.
     * Transitions through 'suspending' to 'suspended'.
     * @returns {Promise<void>} Resolves when suspended
     */
    async suspend () {
        return this.#enqueue(this.#operations.suspend, 'suspending', 'suspended')
    }

    /**
     * Restores resource from suspended state.
     * Transitions through 'resuming' to 'resumed'.
     * @returns {Promise<void>} Resolves when resumed
     */
    async resume () {
        return this.#enqueue(this.#operations.resume, 'resuming', 'resumed')
    }

    /**
     * Waits for the resource to reach a specific state.
     * Useful for coordinating complex sequences of lifecycle operations.
     * @param {string} queryState - The desired state to wait for
     * @returns {Promise<void>} Resolves when target state is reached
     * @example
     * resource.open()              // Start opening
     * await resource.until('opened') // Wait for completion
     */
    async until (queryState) {
        await this.#stateMachine.until(queryState)
    }

    /**
     * Registers a callback to be notified of state transitions.
     * @param {Function} onTransition - Function called with each new state
     */
    on (onTransition) {
        this.#onTransition = onTransition
    }

    /**
     * Checks if the current state matches any of the specified states.
     * @param {...string} queryStates - One or more states to check against
     * @returns {boolean} True if current state matches any specified state
     * @example
     * if (resource.is('opened', 'resumed')) {
     *   // Resource is ready for use
     * }
     */
    is (...queryStates) {
        return queryStates.includes(this.#stateMachine.state)
    }

    /**
     * Checks if the current state does not match any of the specified states.
     * @param {...string} queryStates - One or more states to check against
     * @returns {boolean} True if current state doesn't match any specified state
     * @example
     * if (resource.not('closed', 'error')) {
     *   // Resource is still usable
     * }
     */
    not (...queryStates) {
        return !queryStates.includes(this.#stateMachine.state)
    }

    /**
     * Resets the resource to initial state.
     * Useful for restarting after completion or recovering from errors.
     */
    reset () {
        this.#stateMachine = new StateMachine(this.#transitions)
    }

    /**
     * Executes a lifecycle operation with proper state transitions.
     *
     * This private method performs the actual work of changing states and
     * executing the provided operation function. It first transitions to
     * the interim state, executes the operation, then transitions to the
     * final state if appropriate.
     *
     * If the interim state transition is not allowed, the operation is skipped.
     * If another operation changes the state during execution, the final
     * transition is also skipped.
     *
     * @param {Function} operation - The operation function to execute
     * @param {string} interimState - The state to transition to before executing the operation
     * @param {string} toState - The state to transition to after successful execution
     * @returns {Promise<void>} Resolves when the operation completes
     */
    async #run (operation, interimState, toState) {
        if (!this.#stateMachine.allows(interimState)) {
            return
        }

        this.#stateMachine.transition(interimState)
        this.#onTransition(interimState)

        await operation()

        if (
            this.#stateMachine.state === interimState
            && this.#stateMachine.allows(toState)
        ) {
            this.#stateMachine.transition(toState)
            this.#onTransition(toState)
        }
    }

    /**
     * Enqueues a lifecycle operation for execution.
     *
     * This private method adds an operation to the processing queue,
     * ensuring that lifecycle operations execute in the correct sequence
     * without race conditions.
     *
     * @param {Function} operation - The operation function to execute
     * @param {string} interimState - The state to transition to before executing the operation
     * @param {string} toState - The state to transition to after successful execution
     * @returns {Promise<void>} Resolves when the operation completes
     */
    async #enqueue (operation, interimState, toState) {
        return this.#queue.enqueue({
            operation,
            interimState,
            toState,
        })
    }
}

const noop = async () => {}
