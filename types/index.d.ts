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
    /**
     * Creates a new operation queue.
     *
     * @param {(item: {[key: string]: any}) => Promise<void>} processor - A function that processes each queued item. Must be async or return a Promise.
     * The processor receives an object with properties that depend on the usage context.
     * In Lifecycle usage, this receives an object with {operation, interimState, toState} properties.
     */
    constructor (
        processor: (item: {
            [key: string]: any
        }) => Promise<void>,
    )
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
    enqueue (item: Object): Promise<void>
    #private
}
/**
 * Manages a state machine with controlled transitions and wait conditions.
 * This class enforces valid state transitions according to a predefined transition map
 * and provides utilities for waiting for specific states to be reached.
 */
export class StateMachine {
    /**
     * Creates a new state machine with the specified transition rules.
     * @param {{ [x: string]: string[]; }} transitions - A map of states to arrays of allowed next states.
     * For example: `{ 'init': ['starting'], 'starting': ['started'] }`
     */
    constructor (transitions: {
        [x: string]: string[]
    })
    /**
     * The current state of the state machine.
     * @returns {string} The current state identifier.
     */
    get state (): string
    /**
     * Checks if a transition to the specified state is allowed from the current state.
     * @param {string} toState - The target state to check.
     * @returns {boolean} True if the transition is allowed, false otherwise.
     */
    allows (toState: string): boolean
    /**
     * Returns a promise that resolves when the specified state is reached.
     * This is useful for coordinating actions that depend on specific states.
     * @param {string} queryState - The state to wait for.
     * @returns {Promise<void>} A promise that resolves when the target state is reached.
     */
    until (queryState: string): Promise<void>
    /**
     * Transitions the state machine to a new state if allowed.
     * @param {string} toState - The target state to transition to.
     * @throws {Error} If the transition is not allowed from the current state.
     */
    transition (toState: string): void
    #private
}
/**
 * Manages asynchronous lifecycles for resources like databases, network connections,
 * or any system requiring controlled startup/shutdown sequences.
 * @class
 */
export default class Lifecycle {
    /**
     * Creates a new resource lifecycle manager.
     * @param {Object} operations - Lifecycle handler functions
     * @param {Function} [operations.open] - Resource startup logic
     * @param {Function} [operations.close] - Resource shutdown logic
     * @param {Function} [operations.suspend] - Temporary deactivation logic
     * @param {Function} [operations.resume] - Restoration from suspended state
     */
    constructor (operations: {
        open?: Function
        close?: Function
        suspend?: Function
        resume?: Function
    })
    /**
     * The current state of the resource lifecycle.
     * @type {string} One of: init, opening, opened, suspending, suspended, resuming, closing, closed
     */
    get state (): string
    /**
     * Executes a specific operation with custom transition states.
     * @param {string} operator - The operation name to execute (open, close, suspend, resume)
     * @param {string} interimState - The intermediate state during operation
     * @param {string} toState - The final state after successful completion
     * @returns {Promise<void>} Resolves when the operation completes
     * @throws {Error} If the operator name doesn't exist
     */
    transition (operator: string, interimState: string, toState: string): Promise<void>
    /**
     * Starts the resource initialization process.
     * Transitions from 'init' through 'opening' to 'opened'.
     * Operations are queued and processed in order.
     * @returns {Promise<void>} Resolves when opened
     */
    open (): Promise<void>
    /**
     * Initiates permanent resource shutdown.
     * Transitions through 'closing' to 'closed'.
     * Safe to call from most states.
     * @returns {Promise<void>} Resolves when closed
     */
    close (): Promise<void>
    /**
     * Starts temporary resource deactivation.
     * Transitions through 'suspending' to 'suspended'.
     * @returns {Promise<void>} Resolves when suspended
     */
    suspend (): Promise<void>
    /**
     * Restores resource from suspended state.
     * Transitions through 'resuming' to 'resumed'.
     * @returns {Promise<void>} Resolves when resumed
     */
    resume (): Promise<void>
    /**
     * Waits for the resource to reach a specific state.
     * Useful for coordinating complex sequences of lifecycle operations.
     * @param {string} queryState - The desired state to wait for
     * @returns {Promise<void>} Resolves when target state is reached
     * @example
     * resource.open()              // Start opening
     * await resource.until('opened') // Wait for completion
     */
    until (queryState: string): Promise<void>
    /**
     * Registers a callback to be notified of state transitions.
     * @param {Function} onTransition - Function called with each new state
     */
    on (onTransition: Function): void
    /**
     * Checks if the current state matches any of the specified states.
     * @param {...string} queryStates - One or more states to check against
     * @returns {boolean} True if current state matches any specified state
     * @example
     * if (resource.is('opened', 'resumed')) {
     *   // Resource is ready for use
     * }
     */
    is (...queryStates: string[]): boolean
    /**
     * Checks if the current state does not match any of the specified states.
     * @param {...string} queryStates - One or more states to check against
     * @returns {boolean} True if current state doesn't match any specified state
     * @example
     * if (resource.not('closed', 'error')) {
     *   // Resource is still usable
     * }
     */
    not (...queryStates: string[]): boolean
    /**
     * Resets the resource to initial state.
     * Useful for restarting after completion or recovering from errors.
     */
    reset (): void
    #private
}
